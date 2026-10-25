import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { generateSigningKey, signTicketQr } from "@ticketing/crypto";
import { schema } from "@ticketing/database";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { attendeeNameOf } from "../catalog/attendee";
import { seatTaken } from "../catalog/pricing";
import { eventSalesState, SALES_REASON_TEXT, ticketTypeSalesState } from "../catalog/sales-rules";
import { getStore } from "../database/tenant-context";
import { open as openSecret, seal } from "../security/secret-box";
import { TenantDb } from "../database/tenant-db.service";
import { SEATS_HELD, type SeatsHeldEvent } from "../realtime/seat-events";

/** Tiempo que el comprador tiene para pagar con las entradas bloqueadas. */
export const HOLD_TTL_MINUTES = Number(process.env.HOLD_TTL_MINUTES ?? 10);

/**
 * Canal de venta: la tienda online aplica ventanas y límites; la taquilla no. `manual`
 * = entradas que el promotor añade a mano desde la consola (invitaciones): tampoco
 * aplica límites y vale también con la venta cerrada.
 */
export type SalesChannel = "online" | "pos" | "manual";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

export interface IssuedTicket {
  ticketId: string;
  seatId: string;
  qr: string;
}

/** Postgres unique_violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

/**
 * Motor de reserva (§4). Núcleo del sistema. La garantía anti-sobreventa NO está
 * en el código sino en el esquema: el índice único parcial hold_seat_active_uq
 * (event_id, seat_id) WHERE status IN ('ACTIVE','CONFIRMED'). Dos compras
 * simultáneas del mismo asiento → una hace commit, la otra recibe unique_violation
 * y su transacción entera revierte (atómico).
 */
@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly emitter: EventEmitter2,
  ) {}

  /** Reserva de asientos concretos (categorías numeradas). Atajo de `createHoldMixed`. */
  createHold(eventId: string, seatIds: string[], sessionId: string, channel: SalesChannel = "online") {
    return this.createHoldMixed(eventId, { seatIds }, sessionId, channel);
  }

  /** Reserva por cantidad (categorías generales). Atajo de `createHoldMixed`. */
  createHoldForQuantities(
    eventId: string,
    quantities: Record<string, number>,
    sessionId: string,
    channel: SalesChannel = "online",
  ) {
    return this.createHoldMixed(eventId, { quantities }, sessionId, channel);
  }

  /**
   * Crea UN hold con asientos concretos (categorías NUMERADAS) y/o cantidades por
   * categoría (categorías GENERALES): un mismo evento puede vender platea numerada y
   * pista de pie en un solo pedido. Antes libera holds expirados (lazy release) y valida
   * que todo sea vendible. Las plazas generales se eligen con FOR UPDATE SKIP LOCKED: dos
   * compras simultáneas nunca cogen la misma, y si aun así chocaran, el índice
   * anti-sobreventa (hold_seat_active_uq) es la última barrera. Todo en una transacción.
   */
  async createHoldMixed(
    eventId: string,
    selection: { seatIds?: string[]; quantities?: Record<string, number> },
    sessionId: string,
    channel: SalesChannel = "online",
  ) {
    const ids = [...new Set(selection.seatIds ?? [])];
    const wanted = new Map<string, number>();
    for (const [tt, n] of Object.entries(selection.quantities ?? {})) {
      if (!Number.isInteger(n) || n < 0) throw new BadRequestException("Cantidad inválida");
      if (n > 0) wanted.set(tt, n);
    }
    if (ids.length === 0 && wanted.size === 0) throw new BadRequestException("Elige al menos una entrada");

    const result = await this.db.run(async (tx) => {
      await this.releaseExpiredTx(tx, eventId);
      const ev = await this.loadSellableEventTx(tx, eventId, channel);

      // Asientos concretos: del evento, numerados y con categoría.
      const perType = new Map<string, number>();
      if (ids.length) {
        const seats = await tx
          .select({ id: schema.seat.id, ticketTypeId: schema.seat.ticketTypeId, isGeneral: schema.seat.isGeneral })
          .from(schema.seat)
          .where(and(eq(schema.seat.eventId, eventId), inArray(schema.seat.id, ids)));
        if (seats.length !== ids.length) throw new BadRequestException("Algún asiento no pertenece al evento");
        for (const s of seats) {
          if (s.isGeneral) throw new BadRequestException("Las entradas generales se piden por cantidad, no por asiento");
          if (!s.ticketTypeId) throw new BadRequestException("Hay asientos sin categoría");
          perType.set(s.ticketTypeId, (perType.get(s.ticketTypeId) ?? 0) + 1);
        }
      }
      for (const [tt, n] of wanted) perType.set(tt, (perType.get(tt) ?? 0) + n);

      const types = await this.assertOrderRulesTx(tx, ev, perType, channel);
      // Las cantidades solo valen para categorías generales (las numeradas, por asiento).
      for (const tt of wanted.keys()) {
        if (types.get(tt)?.seating !== "GENERAL") {
          throw new BadRequestException(`${types.get(tt)?.name ?? "Categoría"}: elige los asientos en el plano`);
        }
      }

      const picked = [...ids];
      for (const [ticketTypeId, n] of wanted) {
        const free = await tx
          .select({ id: schema.seat.id })
          .from(schema.seat)
          .where(
            and(
              eq(schema.seat.eventId, eventId),
              eq(schema.seat.ticketTypeId, ticketTypeId),
              eq(schema.seat.isGeneral, true),
              sql`not ${seatTaken(schema.seat.id)}`,
            ),
          )
          .orderBy(schema.seat.numero)
          .limit(n)
          .for("update", { skipLocked: true });
        if (free.length < n) {
          const name = types.get(ticketTypeId)?.name ?? "esa categoría";
          throw new ConflictException(
            free.length === 0 ? `${name}: entradas agotadas` : `${name}: solo quedan ${free.length} entradas`,
          );
        }
        picked.push(...free.map((f) => f.id));
      }
      return this.insertHoldTx(tx, eventId, picked, sessionId);
    });
    this.emitHeld(eventId, result.seatIds, sessionId);
    return result;
  }

  /**
   * Evento vendible por este canal. Online: estado ON_SALE + ventana de venta. Taquilla:
   * solo ON_SALE (en puerta se vende aunque la venta online haya cerrado). Manual:
   * ON_SALE o CLOSED (invitaciones con la venta cerrada; nunca en borrador ni cancelado).
   */
  private async loadSellableEventTx(tx: Tx, eventId: string, channel: SalesChannel) {
    const [ev] = await tx.select().from(schema.event).where(eq(schema.event.id, eventId));
    if (!ev) throw new NotFoundException("Evento no encontrado");
    if (channel === "manual") {
      if (ev.status !== "ON_SALE" && ev.status !== "CLOSED") {
        throw new ConflictException(
          ev.status === "CANCELLED" ? SALES_REASON_TEXT.CANCELLED : "Publica el evento antes de emitir entradas",
        );
      }
      return ev;
    }
    if (channel === "pos") {
      if (ev.status !== "ON_SALE") {
        throw new ConflictException(
          SALES_REASON_TEXT[ev.status === "CANCELLED" ? "CANCELLED" : "NOT_ON_SALE"],
        );
      }
      return ev;
    }
    const state = eventSalesState(ev);
    if (!state.open) throw new ConflictException(SALES_REASON_TEXT[state.reason]);
    return ev;
  }

  /** Reglas del pedido: categorías del evento, ventanas por categoría, mín./máx. */
  private async assertOrderRulesTx(
    tx: Tx,
    ev: typeof schema.event.$inferSelect,
    perType: Map<string, number>,
    channel: SalesChannel,
  ): Promise<Map<string, typeof schema.ticketType.$inferSelect>> {
    const types = await tx
      .select()
      .from(schema.ticketType)
      .where(
        and(eq(schema.ticketType.eventId, ev.id), inArray(schema.ticketType.id, [...perType.keys()])),
      );
    if (types.length !== perType.size) {
      throw new BadRequestException("Categoría inválida para el evento");
    }
    const byId = new Map(types.map((t) => [t.id, t]));
    if (channel !== "online") return byId; // en taquilla manda el taquillero; a mano, el promotor

    const total = [...perType.values()].reduce((a, b) => a + b, 0);
    if (total > ev.maxPerOrder) {
      throw new BadRequestException(`Máximo ${ev.maxPerOrder} entradas por pedido`);
    }
    for (const tt of types) {
      const n = perType.get(tt.id)!;
      const st = ticketTypeSalesState(tt);
      if (!st.open) throw new ConflictException(`${tt.name}: ${SALES_REASON_TEXT[st.reason].toLowerCase()}`);
      if (n < tt.minPerOrder) throw new BadRequestException(`${tt.name}: mínimo ${tt.minPerOrder} por pedido`);
      if (tt.maxPerOrder != null && n > tt.maxPerOrder) {
        throw new BadRequestException(`${tt.name}: máximo ${tt.maxPerOrder} por pedido`);
      }
    }
    return byId;
  }

  private async insertHoldTx(tx: Tx, eventId: string, seatIds: string[], sessionId: string) {
    const tenantId = getStore()!.tenantId;
    const expiresAt = new Date(Date.now() + HOLD_TTL_MINUTES * 60_000);
    const [h] = await tx
      .insert(schema.hold)
      .values({ tenantId, eventId, sessionId, status: "ACTIVE", expiresAt })
      .returning();
    try {
      await tx.insert(schema.holdSeat).values(
        seatIds.map((seatId) => ({
          tenantId,
          holdId: h.id,
          eventId,
          seatId,
          status: "ACTIVE" as const,
        })),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException("Uno o más asientos ya no están disponibles");
      }
      throw e;
    }
    return { holdId: h.id, expiresAt, seatIds };
  }

  // Tras COMMIT: avisa a los demás compradores del evento (tiempo real). El propio
  // comprador lo ignora por `actor` (sessionId) para no auto-bloquearse.
  private emitHeld(eventId: string, seatIds: string[], sessionId: string) {
    this.emitter.emit(SEATS_HELD, { eventId, seatIds, actor: sessionId } satisfies SeatsHeldEvent);
  }

  /**
   * Simula pago OK y emite las entradas: order PAID, hold→CONFIRMED, hold_seat→
   * CONFIRMED, ticket ISSUED por asiento con QR firmado. (El pago real con
   * proveedor + webhook idempotente es Fase 2; aquí confirmamos directamente.)
   */
  /**
   * Confirmación directa (dev/manual): crea order PAID y emite. El camino real de
   * producción es checkout + webhook de pago (Fase 2, ver CheckoutService).
   */
  async confirmAndIssue(holdId: string, buyerEmail?: string) {
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const h = await this.lockActiveHold(tx, holdId);
      const [o] = await tx
        .insert(schema.order)
        .values({ tenantId, eventId: h.eventId, status: "PAID", buyerEmail })
        .returning();
      const tickets = await this.confirmAndIssueForHoldTx(tx, h, o.id);
      return { orderId: o.id, tickets };
    });
  }

  /**
   * Cumple un pedido ya pagado (lo llama el webhook). IDEMPOTENTE: si las entradas
   * del pedido ya existen, las devuelve sin re-emitir. Marca hold/hold_seat
   * CONFIRMED y emite ticket ISSUED por asiento. Deja una entrada en `outbox` para
   * los efectos externos (email/PDF) — patrón transactional outbox (§5).
   */
  async fulfillPaidOrderTx(
    tx: Tx,
    tenantId: string,
    orderId: string,
  ): Promise<{ eventId: string; tickets: IssuedTicket[] }> {
    const [h] = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.orderId, orderId))
      .for("update");
    if (!h) {
      // Cobro tardío de un pedido que se soltó para REINTENTAR el pago (la reserva pasó
      // a otro pedido, ver HoldReleaseService.detachPayment). Ya hay o habrá otro cobro
      // por esas plazas: este se devuelve. Sin error, o el webhook se reintentaría sin fin.
      const [o] = await tx
        .select({ eventId: schema.order.eventId, status: schema.order.status })
        .from(schema.order)
        .where(eq(schema.order.id, orderId));
      if (!o) throw new NotFoundException("No hay hold para el pedido");
      this.logger.error(`PAGO SIN PLAZA: pedido ${orderId} cobrado tras soltarse para reintentar → reembolso`);
      await tx.update(schema.order).set({ status: "CANCELLED" }).where(eq(schema.order.id, orderId));
      await tx.insert(schema.outbox).values({
        tenantId,
        type: "order.refund_required",
        payload: { orderId, reason: "payment_retried_with_another_order" },
      });
      return { eventId: o.eventId, tickets: [] };
    }

    // Defensa: cobro sobre una reserva ya liberada. No debería pasar (antes de liberar
    // se cancela el cobro, ver HoldReleaseService), pero si pasa y la plaza ya es de
    // otro, NO se lanza error: el webhook se reintentaría sin fin. Se cancela el
    // pedido y se deja constancia para DEVOLVER el dinero.
    if (h.status === "EXPIRED" || h.status === "RELEASED") {
      try {
        const tickets = await tx.transaction((sp) => this.confirmAndIssueForHoldTx(sp, h, orderId));
        await tx.insert(schema.outbox).values([
          { tenantId, type: "ticket.issued", payload: { orderId, ticketIds: tickets.map((t) => t.ticketId) } },
          { tenantId, type: "invoice.issue", payload: { orderId } },
        ]);
        return { eventId: h.eventId, tickets };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        this.logger.error(`PAGO SIN PLAZA: pedido ${orderId} cobrado pero sus plazas ya no están libres → reembolso`);
        await tx.update(schema.order).set({ status: "CANCELLED" }).where(eq(schema.order.id, orderId));
        await tx.insert(schema.outbox).values({
          tenantId,
          type: "order.refund_required",
          payload: { orderId, reason: "hold_released_before_payment" },
        });
        return { eventId: h.eventId, tickets: [] };
      }
    }

    const tickets = await this.confirmAndIssueForHoldTx(tx, h, orderId);

    // Efectos externos: email con las entradas y factura (si hubo cobro).
    await tx.insert(schema.outbox).values([
      { tenantId, type: "ticket.issued", payload: { orderId, ticketIds: tickets.map((t) => t.ticketId) } },
      { tenantId, type: "invoice.issue", payload: { orderId } },
    ]);

    return { eventId: h.eventId, tickets };
  }

  /**
   * Emisión PRESENCIAL (POS de taquilla): bloquea el hold activo y emite las
   * entradas dentro de la transacción dada. El cobro (efectivo/datáfono) y el
   * registro de order/payment los orquesta PosService alrededor de esta llamada.
   */
  async issueHoldForPosTx(tx: Tx, holdId: string, orderId: string): Promise<IssuedTicket[]> {
    // También lo usa la emisión manual de la consola (TicketsService).
    const h = await this.lockActiveHold(tx, holdId);
    return this.confirmAndIssueForHoldTx(tx, h, orderId);
  }

  private async lockActiveHold(tx: Tx, holdId: string) {
    const [h] = await tx
      .select()
      .from(schema.hold)
      .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")))
      .for("update");
    if (!h) throw new NotFoundException("Hold inexistente o no activo");
    if (h.expiresAt.getTime() < Date.now()) {
      throw new ConflictException("El hold ha expirado");
    }
    return h;
  }

  /** Marca el hold confirmado y emite tickets. Idempotente por pedido. */
  private async confirmAndIssueForHoldTx(
    tx: Tx,
    h: typeof schema.hold.$inferSelect,
    orderId: string,
  ): Promise<IssuedTicket[]> {
    const keyRef = await this.getOrCreateEventKey(tx, h.tenantId, h.eventId);

    // Idempotencia: si ya hay tickets para el pedido, re-firmar y devolver.
    const existing = await tx
      .select({ id: schema.ticket.id, seatId: schema.ticket.seatId })
      .from(schema.ticket)
      .where(eq(schema.ticket.orderId, orderId));
    if (existing.length > 0) {
      return existing.map((t) => ({
        ticketId: t.id,
        seatId: t.seatId,
        qr: signTicketQr({ t: t.id, e: h.eventId }, keyRef.key),
      }));
    }

    await tx
      .update(schema.hold)
      .set({ status: "CONFIRMED", orderId, version: h.version + 1 })
      .where(eq(schema.hold.id, h.id));
    await tx
      .update(schema.holdSeat)
      .set({ status: "CONFIRMED" })
      .where(eq(schema.holdSeat.holdId, h.id));

    const seats = await tx
      .select({
        seatId: schema.holdSeat.seatId,
        attendee: schema.holdSeat.attendee,
        priceCents: schema.holdSeat.priceCents,
        fareId: schema.holdSeat.fareId,
        fareName: schema.fare.name,
      })
      .from(schema.holdSeat)
      .leftJoin(schema.fare, eq(schema.fare.id, schema.holdSeat.fareId))
      .where(eq(schema.holdSeat.holdId, h.id));

    const issued: IssuedTicket[] = [];
    for (const { seatId, attendee, priceCents, fareId, fareName } of seats) {
      const [tk] = await tx
        .insert(schema.ticket)
        .values({
          tenantId: h.tenantId,
          eventId: h.eventId,
          seatId,
          orderId,
          status: "ISSUED",
          qrKeyId: keyRef.id,
          attendee,
          attendeeName: attendeeNameOf(attendee),
          priceCents,
          fareId,
          fareName,
        })
        .returning();
      issued.push({
        ticketId: tk.id,
        seatId,
        qr: signTicketQr({ t: tk.id, e: h.eventId }, keyRef.key),
      });
    }
    return issued;
  }

  /** Libera holds expirados (ACTIVE + expires_at pasado) → EXPIRED. Para el sweeper. */
  async releaseExpired(): Promise<number> {
    return this.db.run((tx) => this.releaseExpiredTx(tx));
  }

  private async releaseExpiredTx(tx: Parameters<Parameters<TenantDb["run"]>[0]>[0], eventId?: string) {
    const expiredHolds = await tx
      .update(schema.hold)
      .set({ status: "EXPIRED" })
      .where(
        and(
          eq(schema.hold.status, "ACTIVE"),
          lt(schema.hold.expiresAt, new Date()),
          // Las que tienen pago iniciado NO se sueltan aquí (dentro de una tx no se
          // puede llamar a la pasarela): las libera el sweeper cancelando el cobro.
          isNull(schema.hold.orderId),
          ...(eventId ? [eq(schema.hold.eventId, eventId)] : []),
        ),
      )
      .returning({ id: schema.hold.id });

    if (expiredHolds.length > 0) {
      await tx
        .update(schema.holdSeat)
        .set({ status: "EXPIRED" })
        .where(
          and(
            eq(schema.holdSeat.status, "ACTIVE"),
            inArray(
              schema.holdSeat.holdId,
              expiredHolds.map((r) => r.id),
            ),
          ),
        );
    }
    return expiredHolds.length;
  }

  private async getOrCreateEventKey(
    tx: Parameters<Parameters<TenantDb["run"]>[0]>[0],
    tenantId: string,
    eventId: string,
  ): Promise<{ id: string; key: string }> {
    const [existing] = await tx
      .select()
      .from(schema.eventSigningKey)
      .where(eq(schema.eventSigningKey.eventId, eventId))
      .limit(1);
    if (existing) {
      return { id: existing.id, key: openSecret(existing.encryptedKey) };
    }
    const key = generateSigningKey();
    const [created] = await tx
      .insert(schema.eventSigningKey)
      .values({ tenantId, eventId, encryptedKey: seal(key) }) // cifrada en reposo (E1)
      .returning();
    return { id: created.id, key };
  }
}
