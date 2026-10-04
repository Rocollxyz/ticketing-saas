import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { type AttendeeAnswer, schema } from "@ticketing/database";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import { attendeeNameOf, type FieldDef, fieldsFor, validateAttendees } from "../catalog/attendee";
import { formatInZone } from "../catalog/format";
import { qualified, seatTaken } from "../catalog/pricing";
import { seatLabel } from "../catalog/seat-label";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { SEATS_RELEASED, SEATS_SOLD, type SeatsReleasedEvent, type SeatsSoldEvent } from "../realtime/seat-events";
import { ReservationService } from "../reservation/reservation.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];
type TicketStatus = "ISSUED" | "CHECKED_IN" | "VOID";

const PAGE = 100;
const MAX_MANUAL = 50;
/** Marca del pago de las entradas añadidas a mano (para distinguir el canal). */
const INVITATION_REF = "INVITACION";

export type Channel = "online" | "taquilla" | "invitacion";
const CHANNEL_LABEL: Record<Channel, string> = { online: "Online", taquilla: "Taquilla", invitacion: "Invitación" };
const STATUS_LABEL: Record<TicketStatus, string> = { ISSUED: "Válida", CHECKED_IN: "Validada", VOID: "Anulada" };

/** Canal de venta del pedido, a partir de su pago (sin pago = pedido gratuito online). */
const channelSql = sql<Channel>`(
  select case
    when p.provider_ref = ${INVITATION_REF} then 'invitacion'
    when p.provider in ('cash','tpv') then 'taquilla'
    else 'online' end
  from payment p where p.order_id = ${qualified(schema.ticket.orderId)} order by p.created_at limit 1
)`;
const channelOf = (c: Channel | null): Channel => c ?? "online";

/** Primera validación correcta en el acceso. */
const checkedInAtSql = sql<Date | null>`(
  select min(c.scanned_at) from check_in c where c.ticket_id = ${qualified(schema.ticket.id)} and c.result = 'OK'
)`.mapWith((v: string | null) => (v ? new Date(v) : null));

/**
 * Gestión de las entradas emitidas de un evento (consola del promotor): listado con
 * búsqueda, edición de los datos del asistente, reenvío por email, anulación, emisión
 * manual (invitaciones) y exportación a CSV. Solo el promotor: hay datos personales.
 * Cada acción que cambia algo deja rastro en `audit_log`.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly db: TenantDb,
    private readonly reservation: ReservationService,
    private readonly emitter: EventEmitter2,
  ) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede gestionar las entradas");
    }
  }

  /** Listado paginado. `q` busca en titular, comprador, datos del asistente e ids. */
  list(eventId: string, query: { q?: string; status?: string; ticketTypeId?: string; offset?: string }) {
    this.assertPromoter();
    const status = input.oneOf(query.status || undefined, "Estado", ["ISSUED", "CHECKED_IN", "VOID"] as const);
    const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
    return this.db.run(async (tx) => {
      await this.loadEventTx(tx, eventId);
      const where = this.filters(eventId, query.q, status, query.ticketTypeId);
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.ticket)
        .innerJoin(schema.order, eq(schema.order.id, schema.ticket.orderId))
        .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
        .where(where);
      const rows = await this.rowsTx(tx, where, { limit: PAGE, offset });
      const [counts] = await tx
        .select({
          issued: sql<number>`count(*) filter (where ${schema.ticket.status} = 'ISSUED')`.mapWith(Number),
          checkedIn: sql<number>`count(*) filter (where ${schema.ticket.status} = 'CHECKED_IN')`.mapWith(Number),
          void: sql<number>`count(*) filter (where ${schema.ticket.status} = 'VOID')`.mapWith(Number),
        })
        .from(schema.ticket)
        .where(eq(schema.ticket.eventId, eventId));
      return { total, offset, pageSize: PAGE, counts, tickets: rows };
    });
  }

  private filters(eventId: string, q: string | undefined, status?: TicketStatus, ticketTypeId?: string) {
    const conds: SQL[] = [eq(schema.ticket.eventId, eventId)];
    if (status) conds.push(eq(schema.ticket.status, status));
    if (ticketTypeId) conds.push(eq(schema.seat.ticketTypeId, ticketTypeId));
    const term = q?.trim().slice(0, 100);
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(sql`(
        ${schema.ticket.attendeeName} ilike ${like}
        or ${schema.order.buyerEmail} ilike ${like}
        or ${schema.order.buyerName} ilike ${like}
        or ${schema.ticket.attendee}::text ilike ${like}
        or ${schema.ticket.id}::text ilike ${`${term.toLowerCase()}%`}
        or ${schema.ticket.orderId}::text ilike ${`${term.toLowerCase()}%`}
      )`);
    }
    return and(...conds)!;
  }

  private async rowsTx(tx: Tx, where: SQL, page?: { limit: number; offset: number }) {
    const base = tx
      .select({
        id: schema.ticket.id,
        status: schema.ticket.status,
        orderId: schema.ticket.orderId,
        attendeeName: schema.ticket.attendeeName,
        attendee: schema.ticket.attendee,
        createdAt: schema.ticket.createdAt,
        buyerEmail: schema.order.buyerEmail,
        buyerName: schema.order.buyerName,
        ticketTypeId: schema.seat.ticketTypeId,
        fila: schema.seat.fila,
        numero: schema.seat.numero,
        isGeneral: schema.seat.isGeneral,
        categoria: schema.ticketType.name,
        channel: channelSql,
        checkedInAt: checkedInAtSql,
        couponCode: sql<string | null>`(select c.code from coupon c where c.id = ${qualified(schema.order.couponId)})`,
      })
      .from(schema.ticket)
      .innerJoin(schema.order, eq(schema.order.id, schema.ticket.orderId))
      .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
      .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
      .where(where)
      .orderBy(desc(schema.ticket.createdAt), asc(schema.seat.fila), asc(schema.seat.numero));
    const rows = page ? await base.limit(page.limit).offset(page.offset) : await base;
    return rows.map(({ fila, numero, isGeneral, ...r }) => ({
      ...r,
      seat: seatLabel({ fila, numero, isGeneral, categoria: r.categoria }),
      isGeneral,
      channel: channelOf(r.channel),
      attendee: r.attendee ?? [],
    }));
  }

  /**
   * Corrige los datos del asistente. Valida con el formulario ACTUAL del evento (pero
   * sin obligar: el promotor puede completar lo que falte poco a poco) y conserva las
   * respuestas de campos que ya no existen.
   */
  async updateAttendee(eventId: string, ticketId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const values = body.values && typeof body.values === "object" ? body.values : {};
    return this.db.run(async (tx) => {
      const tk = await this.loadTicketTx(tx, eventId, ticketId);
      const fields = (await this.fieldsTx(tx, eventId)).map((f) => ({ ...f, required: false }));
      const applicable = fieldsFor(fields, tk.ticketTypeId);
      if (applicable.length === 0) {
        throw new BadRequestException("Este evento no pide datos para esta categoría (pestaña «Formulario»)");
      }
      const answers =
        validateAttendees(applicable, [{ seatId: tk.seatId, ticketTypeId: tk.ticketTypeId }], [
          { seatId: tk.seatId, values },
        ]).get(tk.seatId) ?? [];
      const current = new Set(applicable.map((f) => f.id));
      const kept = (tk.attendee ?? []).filter((a) => !current.has(a.fieldId));
      const attendee: AttendeeAnswer[] = [...answers, ...kept];
      await tx
        .update(schema.ticket)
        .set({ attendee, attendeeName: attendeeNameOf(attendee), updatedAt: new Date() })
        .where(eq(schema.ticket.id, ticketId));
      await this.auditTx(tx, "ticket.attendee_updated", { ticketId, before: tk.attendee ?? [], after: attendee });
      return { ok: true as const, attendee, attendeeName: attendeeNameOf(attendee) };
    });
  }

  /**
   * Reenvía por email las entradas: una sola (`ticketId`) o todo su pedido
   * (`wholeOrder`), al comprador o a otra dirección (`to`). Lo envía el worker del
   * outbox (mismo PDF que en la compra, con los datos del asistente al día).
   */
  async resend(eventId: string, ticketId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const to = input.email(body.to, "Email");
    return this.db.run(async (tx) => {
      const tk = await this.loadTicketTx(tx, eventId, ticketId);
      if (tk.status === "VOID") throw new ConflictException("La entrada está anulada");
      const ticketIds =
        body.wholeOrder === true
          ? (
              await tx
                .select({ id: schema.ticket.id })
                .from(schema.ticket)
                .where(and(eq(schema.ticket.orderId, tk.orderId), sql`${schema.ticket.status} <> 'VOID'`))
            ).map((t) => t.id)
          : [ticketId];
      const recipient = to ?? tk.buyerEmail;
      if (!recipient) throw new BadRequestException("El pedido no tiene email: indica a quién enviarlo");
      await tx.insert(schema.outbox).values({
        tenantId: getStore()!.tenantId,
        type: "ticket.issued",
        payload: { orderId: tk.orderId, ticketIds, to: recipient, resend: true },
      });
      await this.auditTx(tx, "ticket.resent", { orderId: tk.orderId, ticketIds, to: recipient });
      return { ok: true as const, to: recipient, count: ticketIds.length };
    });
  }

  /**
   * Anula una entrada: deja de valer en el acceso (también offline, al refrescar el
   * paquete). Con `release` la plaza vuelve a estar a la venta. NO devuelve el dinero.
   */
  async void(eventId: string, ticketId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const release = body.release !== false;
    const result = await this.db.run(async (tx) => {
      const tk = await this.loadTicketTx(tx, eventId, ticketId, true);
      if (tk.status === "VOID") throw new ConflictException("La entrada ya está anulada");
      await tx
        .update(schema.ticket)
        .set({ status: "VOID", updatedAt: new Date() })
        .where(eq(schema.ticket.id, ticketId));
      if (release) {
        // La plaza la retiene el hold_seat CONFIRMED del pedido (índice anti-sobreventa).
        await tx
          .update(schema.holdSeat)
          .set({ status: "RELEASED", updatedAt: new Date() })
          .where(
            and(
              eq(schema.holdSeat.eventId, eventId),
              eq(schema.holdSeat.seatId, tk.seatId),
              eq(schema.holdSeat.status, "CONFIRMED"),
            ),
          );
      }
      await this.auditTx(tx, "ticket.voided", {
        ticketId,
        orderId: tk.orderId,
        previousStatus: tk.status,
        released: release,
        reason: input.text(body.reason, "Motivo", 300) ?? null,
      });
      return { seatId: tk.seatId };
    });
    if (release) {
      this.emitter.emit(SEATS_RELEASED, { eventId, seatIds: [result.seatId] } satisfies SeatsReleasedEvent);
    }
    return { ok: true as const, released: release };
  }

  /**
   * Emite entradas a mano, sin cobro (invitaciones, prensa, compromisos). Por cantidad
   * y categoría; en numerado se asignan los primeros asientos libres de la categoría.
   * Pasa por el motor de reserva (misma anti-sobreventa) y queda como un pedido pagado
   * de 0 € marcado como invitación.
   */
  async issueManual(eventId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    const buyerName = input.text(body.buyerName, "Nombre", 200) ?? null;
    const buyerEmail = input.email(body.buyerEmail, "Email") ?? null;
    const sendEmail = body.sendEmail !== false && !!buyerEmail;
    const quantities: Record<string, number> = {};
    for (const [tt, n] of Object.entries((body.quantities as Record<string, unknown>) ?? {})) {
      const q = input.int(n, "Cantidad", 0, MAX_MANUAL, false)!;
      if (q > 0) quantities[tt] = q;
    }
    const total = Object.values(quantities).reduce((a, b) => a + b, 0);
    if (total === 0) throw new BadRequestException("Indica cuántas entradas emitir");
    if (total > MAX_MANUAL) throw new BadRequestException(`Máximo ${MAX_MANUAL} entradas de una vez`);

    const actor = `manual:${getStore()!.userId}`;
    const ev = await this.db.run((tx) => this.loadEventTx(tx, eventId));
    const { holdId, seatIds } =
      ev.seatingMode === "GENERAL"
        ? await this.reservation.createHoldForQuantities(eventId, quantities, actor, "manual")
        : await this.reservation.createHold(
            eventId,
            await this.db.run((tx) => this.pickSeatsTx(tx, eventId, quantities)),
            actor,
            "manual",
          );

    const result = await this.db.run(async (tx) => {
      const [o] = await tx
        .insert(schema.order)
        .values({ tenantId, eventId, status: "PAID", buyerEmail, buyerName })
        .returning();
      await tx.insert(schema.payment).values({
        tenantId,
        orderId: o.id,
        provider: "cash",
        providerRef: INVITATION_REF,
        amountCents: 0n,
        status: "CAPTURED",
      });
      // El nombre del invitado, como titular de las entradas si el formulario lo pide.
      if (buyerName) await this.prefillNameTx(tx, eventId, holdId, buyerName);
      const tickets = await this.reservation.issueHoldForPosTx(tx, holdId, o.id);
      if (sendEmail) {
        await tx.insert(schema.outbox).values({
          tenantId,
          type: "ticket.issued",
          payload: { orderId: o.id, ticketIds: tickets.map((t) => t.ticketId) },
        });
      }
      await this.auditTx(tx, "ticket.manual_issued", {
        orderId: o.id,
        quantities,
        buyerEmail,
        emailed: sendEmail,
      });
      return { orderId: o.id, ticketIds: tickets.map((t) => t.ticketId) };
    });
    this.emitter.emit(SEATS_SOLD, { eventId, seatIds } satisfies SeatsSoldEvent);
    return { ...result, emailed: sendEmail };
  }

  /** Numerado: primeros asientos libres de cada categoría (por fila y número). */
  private async pickSeatsTx(tx: Tx, eventId: string, quantities: Record<string, number>) {
    const picked: string[] = [];
    for (const [ticketTypeId, n] of Object.entries(quantities)) {
      const free = await tx
        .select({ id: schema.seat.id })
        .from(schema.seat)
        .where(
          and(
            eq(schema.seat.eventId, eventId),
            eq(schema.seat.ticketTypeId, ticketTypeId),
            sql`not ${seatTaken(schema.seat.id)}`,
          ),
        )
        .orderBy(schema.seat.fila, schema.seat.numero)
        .limit(n);
      if (free.length < n) {
        throw new ConflictException(
          free.length === 0 ? "No quedan asientos libres en esa categoría" : `Solo quedan ${free.length} asientos libres`,
        );
      }
      picked.push(...free.map((f) => f.id));
    }
    return picked;
  }

  private async prefillNameTx(tx: Tx, eventId: string, holdId: string, name: string) {
    const [nameField] = (await this.fieldsTx(tx, eventId)).filter((f) => f.presetKey === "name");
    if (!nameField) return;
    const seats = await tx
      .select({ id: schema.holdSeat.id, ticketTypeId: schema.seat.ticketTypeId })
      .from(schema.holdSeat)
      .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
      .where(eq(schema.holdSeat.holdId, holdId));
    for (const s of seats) {
      if (fieldsFor([nameField], s.ticketTypeId).length === 0) continue;
      const answer: AttendeeAnswer = {
        fieldId: nameField.id,
        label: nameField.label,
        value: name,
        ...(nameField.showOnTicket ? { onTicket: true } : {}),
        preset: "name",
      };
      await tx.update(schema.holdSeat).set({ attendee: [answer] }).where(eq(schema.holdSeat.id, s.id));
    }
  }

  /** CSV (separador «;» y BOM, para que Excel en español lo abra bien). */
  async exportCsv(eventId: string, query: { q?: string; status?: string; ticketTypeId?: string }) {
    this.assertPromoter();
    const status = input.oneOf(query.status || undefined, "Estado", ["ISSUED", "CHECKED_IN", "VOID"] as const);
    return this.db.run(async (tx) => {
      const ev = await this.loadEventTx(tx, eventId);
      const rows = await this.rowsTx(tx, this.filters(eventId, query.q, status, query.ticketTypeId));
      const fields = await this.fieldsTx(tx, eventId);

      // Una columna por campo del formulario actual; después, los de campos ya borrados.
      const cols = fields.map((f) => ({ id: f.id, label: f.label }));
      const known = new Set(cols.map((c) => c.id));
      for (const r of rows) {
        for (const a of r.attendee) {
          if (!known.has(a.fieldId)) {
            known.add(a.fieldId);
            cols.push({ id: a.fieldId, label: a.label });
          }
        }
      }

      const when = (d: Date | null) => (d ? formatInZone(d, ev.timezone) : "");
      const header = [
        "Entrada",
        "Estado",
        "Categoría",
        "Plaza",
        "Titular",
        "Comprador",
        "Email comprador",
        "Pedido",
        "Canal",
        "Código descuento",
        "Emitida",
        "Validada",
        ...cols.map((c) => c.label),
      ];
      const lines = rows.map((r) => {
        const byField = new Map(r.attendee.map((a) => [a.fieldId, a.value]));
        return [
          r.id,
          STATUS_LABEL[r.status as TicketStatus],
          r.categoria ?? "",
          r.isGeneral ? "" : r.seat,
          r.attendeeName ?? "",
          r.buyerName ?? "",
          r.buyerEmail ?? "",
          r.orderId,
          CHANNEL_LABEL[r.channel],
          r.couponCode ?? "",
          when(r.createdAt),
          when(r.checkedInAt),
          ...cols.map((c) => byField.get(c.id) ?? ""),
        ];
      });
      const csv = [header, ...lines].map((l) => l.map(csvCell).join(";")).join("\r\n");
      const slug = ev.name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "evento";
      return { filename: `asistentes-${slug}.csv`, body: `﻿${csv}\r\n` };
    });
  }

  private async loadEventTx(tx: Tx, eventId: string) {
    const [ev] = await tx.select().from(schema.event).where(eq(schema.event.id, eventId));
    if (!ev) throw new NotFoundException("Evento no encontrado");
    return ev;
  }

  private async loadTicketTx(tx: Tx, eventId: string, ticketId: string, lock = false) {
    const q = tx
      .select({
        id: schema.ticket.id,
        status: schema.ticket.status,
        seatId: schema.ticket.seatId,
        orderId: schema.ticket.orderId,
        attendee: schema.ticket.attendee,
        ticketTypeId: schema.seat.ticketTypeId,
        buyerEmail: schema.order.buyerEmail,
      })
      .from(schema.ticket)
      .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
      .innerJoin(schema.order, eq(schema.order.id, schema.ticket.orderId))
      .where(and(eq(schema.ticket.id, ticketId), eq(schema.ticket.eventId, eventId)));
    const [tk] = lock ? await q.for("update", { of: schema.ticket }) : await q;
    if (!tk) throw new NotFoundException("Entrada no encontrada");
    return tk;
  }

  private fieldsTx(tx: Tx, eventId: string): Promise<FieldDef[]> {
    return tx
      .select({
        id: schema.attendeeField.id,
        presetKey: schema.attendeeField.presetKey,
        label: schema.attendeeField.label,
        type: schema.attendeeField.type,
        required: schema.attendeeField.required,
        options: schema.attendeeField.options,
        ticketTypeIds: schema.attendeeField.ticketTypeIds,
        showOnTicket: schema.attendeeField.showOnTicket,
      })
      .from(schema.attendeeField)
      .where(eq(schema.attendeeField.eventId, eventId))
      .orderBy(schema.attendeeField.sortOrder);
  }

  private auditTx(tx: Tx, action: string, diff: Record<string, unknown>) {
    const store = getStore()!;
    return tx.insert(schema.auditLog).values({
      tenantId: store.tenantId,
      actorUserId: store.userId,
      action,
      diff,
    });
  }
}

/**
 * Celda CSV escapada. Neutraliza la inyección de fórmulas (=, +, -, @ al inicio) que
 * Excel ejecutaría: un comprador controla su nombre y sus respuestas.
 */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
