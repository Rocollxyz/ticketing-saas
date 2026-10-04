import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { currentPriceCents, qualified } from "../catalog/pricing";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { seatHasHistory, syncGeneralSeats } from "./general-seats";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];
type EventRow = typeof schema.event.$inferSelect;

export type StatusAction = "publish" | "unpublish" | "close" | "reopen" | "cancel";

/**
 * Entradas vendidas (no anuladas) / recaudación neta (cobros menos devoluciones hechas)
 * / aforo por evento, como subconsultas.
 */
const soldSql = sql<number>`(
  select count(*) from ticket t where t.event_id = ${qualified(schema.event.id)} and t.status <> 'VOID'
)`.mapWith(Number);
const revenueSql = sql<number>`(
  select coalesce(sum(p.amount_cents), 0) from payment p
  join "order" o on o.id = p.order_id
  where o.event_id = ${qualified(schema.event.id)} and p.status in ('CAPTURED','REFUNDED')
) - (
  select coalesce(sum(r.amount_cents), 0) from refund r
  join "order" o on o.id = r.order_id
  where o.event_id = ${qualified(schema.event.id)} and r.status = 'SUCCEEDED'
)`.mapWith(Number);
const capacitySql = sql<number>`(
  select count(*) from seat s where s.event_id = ${qualified(schema.event.id)} and s.ticket_type_id is not null
)`.mapWith(Number);

/**
 * Gestión de eventos del promotor: alta, edición, ciclo de vida (borrador → a la
 * venta → cerrado / cancelado) y duplicado. Bajo RLS: solo ve/toca su tenant. Leer
 * puede cualquier rol del tenant (la app del portero lista eventos); escribir, solo
 * el promotor.
 */
@Injectable()
export class EventsService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede gestionar eventos");
    }
  }

  list() {
    return this.db.run((tx) =>
      tx
        .select({
          id: schema.event.id,
          name: schema.event.name,
          status: schema.event.status,
          startsAt: schema.event.startsAt,
          timezone: schema.event.timezone,
          imageUrl: schema.event.imageUrl,
          visibility: schema.event.visibility,
          seatingMode: schema.event.seatingMode,
          venueName: schema.venue.name,
          sold: soldSql,
          capacity: capacitySql,
          revenueCents: revenueSql,
        })
        .from(schema.event)
        .leftJoin(schema.venue, eq(schema.venue.id, schema.event.venueId))
        .orderBy(sql`${schema.event.startsAt} desc nulls first`),
    );
  }

  /** Ficha completa para el editor: evento, recinto, categorías con ventas y checklist. */
  get(eventId: string) {
    return this.db.run((tx) => this.getTx(tx, eventId));
  }

  private async getTx(tx: Tx, eventId: string) {
    const ev = await this.loadTx(tx, eventId);
    const [venue] = ev.venueId
      ? await tx.select().from(schema.venue).where(eq(schema.venue.id, ev.venueId))
      : [];

    const types = await tx
      .select({
        tt: schema.ticketType,
        currentCents: currentPriceCents(schema.ticketType.id),
        seats: sql<number>`(select count(*) from seat s where s.ticket_type_id = ${qualified(schema.ticketType.id)})`.mapWith(Number),
        sold: sql<number>`(
          select count(*) from ticket t join seat s on s.id = t.seat_id
          where s.ticket_type_id = ${qualified(schema.ticketType.id)} and t.status <> 'VOID'
        )`.mapWith(Number),
      })
      .from(schema.ticketType)
      .where(eq(schema.ticketType.eventId, eventId))
      .orderBy(schema.ticketType.sortOrder, schema.ticketType.name);

    const prices = types.length
      ? await tx
          .select()
          .from(schema.price)
          .where(inArray(schema.price.ticketTypeId, types.map((t) => t.tt.id)))
      : [];

    const [stats] = await tx
      .select({ sold: soldSql, revenueCents: revenueSql, capacity: capacitySql })
      .from(schema.event)
      .where(eq(schema.event.id, eventId));

    return {
      event: ev,
      venue: venue ?? null,
      ticketTypes: types.map(({ tt, currentCents, seats, sold }) => {
        const mine = prices.filter((p) => p.ticketTypeId === tt.id);
        const regular = mine.find((p) => p.validTo == null);
        const early = mine.find((p) => p.validTo != null);
        return {
          ...tt,
          priceCents: regular ? Number(regular.amountCents) : null,
          earlyBird: early ? { priceCents: Number(early.amountCents), until: early.validTo } : null,
          currentCents,
          capacity: seats, // plazas con esta categoría (aforo en general, asientos en numerado)
          sold,
        };
      }),
      stats,
      checklist: await this.checklistTx(tx, ev),
    };
  }

  async create(body: Record<string, unknown>) {
    this.assertPromoter();
    const data = this.parse(body, true);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      if (data.venueId) await this.assertVenueTx(tx, data.venueId);
      const [ev] = await tx
        .insert(schema.event)
        .values({ ...data, name: data.name!, tenantId, status: "DRAFT" })
        .returning();
      return ev;
    });
  }

  async update(eventId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const data = this.parse(body, false);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const ev = await this.loadTx(tx, eventId, true);
      if (ev.status === "CANCELLED") throw new ConflictException("Un evento cancelado no se puede editar");
      if (data.venueId) await this.assertVenueTx(tx, data.venueId);

      const merged = { ...ev, ...data };
      this.assertDates(merged);

      if (data.seatingMode && data.seatingMode !== ev.seatingMode) {
        await this.switchSeatingModeTx(tx, tenantId, ev, data.seatingMode);
      }

      await tx
        .update(schema.event)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.event.id, eventId));
      return this.getTx(tx, eventId);
    });
  }

  /** Transiciones de estado. Publicar/reabrir exigen la checklist completa. */
  async setStatus(eventId: string, action: StatusAction) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      const ev = await this.loadTx(tx, eventId, true);
      const set = (status: EventRow["status"], extra: Partial<EventRow> = {}) =>
        tx
          .update(schema.event)
          .set({ status, updatedAt: new Date(), ...extra })
          .where(eq(schema.event.id, eventId));

      const from = (...allowed: EventRow["status"][]) => {
        if (!allowed.includes(ev.status)) {
          throw new ConflictException(`No se puede ${ACTION_TEXT[action]} un evento ${STATUS_TEXT[ev.status]}`);
        }
      };

      switch (action) {
        case "publish":
        case "reopen": {
          from(...(action === "publish" ? (["DRAFT"] as const) : (["CLOSED"] as const)));
          const problems = await this.checklistTx(tx, ev);
          if (problems.length) {
            throw new BadRequestException({ message: "El evento no está listo para la venta", problems });
          }
          await set("ON_SALE", action === "publish" ? { publishedAt: new Date() } : {});
          break;
        }
        case "unpublish": {
          from("ON_SALE");
          const [{ n }] = await tx
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(schema.holdSeat)
            .where(and(eq(schema.holdSeat.eventId, eventId), ne(schema.holdSeat.status, "EXPIRED")));
          if (n > 0) {
            throw new ConflictException(
              "Ya hay ventas o reservas: no se puede volver a borrador. Usa «Cerrar venta».",
            );
          }
          await set("DRAFT");
          break;
        }
        case "close":
          from("ON_SALE");
          await set("CLOSED");
          break;
        case "cancel":
          from("DRAFT", "ON_SALE", "CLOSED");
          await set("CANCELLED");
          break;
        default:
          throw new BadRequestException("Acción desconocida");
      }
      return this.getTx(tx, eventId);
    });
  }

  /**
   * Duplica un evento como BORRADOR "(copia)": datos, categorías con sus precios
   * (anticipada incluida) y el plano (numerado) o el aforo (entrada general). Sin
   * ventas, holds ni clave de firma: es un evento nuevo.
   */
  async duplicate(eventId: string) {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const src = await this.loadTx(tx, eventId);
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        deletedAt: _d,
        publishedAt: _p,
        status: _s,
        ...fields
      } = src;
      const [copy] = await tx
        .insert(schema.event)
        .values({ ...fields, tenantId, name: `${src.name} (copia)`, status: "DRAFT" })
        .returning();

      const types = await tx.select().from(schema.ticketType).where(eq(schema.ticketType.eventId, eventId));
      const typeMap = new Map<string, string>();
      for (const { id, createdAt: _tc, updatedAt: _tu, eventId: _e, ...tt } of types) {
        const [n] = await tx
          .insert(schema.ticketType)
          .values({ ...tt, tenantId, eventId: copy.id })
          .returning({ id: schema.ticketType.id });
        typeMap.set(id, n.id);
        const prices = await tx.select().from(schema.price).where(eq(schema.price.ticketTypeId, id));
        if (prices.length) {
          await tx.insert(schema.price).values(
            prices.map((p) => ({
              tenantId,
              ticketTypeId: n.id,
              amountCents: p.amountCents,
              currency: p.currency,
              validFrom: p.validFrom,
              validTo: p.validTo,
            })),
          );
        }
      }

      // Formulario de asistentes (con sus categorías traducidas a las del evento nuevo).
      const formFields = await tx
        .select()
        .from(schema.attendeeField)
        .where(eq(schema.attendeeField.eventId, eventId));
      if (formFields.length) {
        await tx.insert(schema.attendeeField).values(
          formFields.map(({ id: _i, createdAt: _c, updatedAt: _u, eventId: _e, ticketTypeIds, ...f }) => ({
            ...f,
            tenantId,
            eventId: copy.id,
            ticketTypeIds: ticketTypeIds?.map((t) => typeMap.get(t)).filter((t): t is string => !!t) ?? null,
          })),
        );
      }

      if (src.seatingMode === "GENERAL") {
        for (const tt of types) {
          const [{ n }] = await tx
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(schema.seat)
            .where(and(eq(schema.seat.ticketTypeId, tt.id), eq(schema.seat.isGeneral, true)));
          await syncGeneralSeats(tx, tenantId, copy.id, typeMap.get(tt.id)!, n);
        }
      } else {
        const zones = await tx.select().from(schema.zone).where(eq(schema.zone.eventId, eventId));
        const zoneMap = new Map<string, string>();
        for (const z of zones) {
          const [nz] = await tx
            .insert(schema.zone)
            .values({ tenantId, eventId: copy.id, name: z.name })
            .returning({ id: schema.zone.id });
          zoneMap.set(z.id, nz.id);
        }
        const seats = await tx
          .select()
          .from(schema.seat)
          .where(and(eq(schema.seat.eventId, eventId), eq(schema.seat.isGeneral, false)));
        if (seats.length) {
          await tx.insert(schema.seat).values(
            seats.map((s) => ({
              tenantId,
              eventId: copy.id,
              zoneId: zoneMap.get(s.zoneId)!,
              ticketTypeId: s.ticketTypeId ? typeMap.get(s.ticketTypeId)! : null,
              fila: s.fila,
              numero: s.numero,
              posX: s.posX,
              posY: s.posY,
            })),
          );
        }
      }
      return copy;
    });
  }

  /** Lo que falta para poder vender. Lista vacía = listo. */
  private async checklistTx(tx: Tx, ev: EventRow): Promise<string[]> {
    const problems: string[] = [];
    if (!ev.startsAt) problems.push("Falta la fecha de inicio");
    else if (ev.startsAt.getTime() <= Date.now()) problems.push("La fecha de inicio ya ha pasado");
    if (!ev.venueId) problems.push("Falta el recinto");

    const types = await tx
      .select({ name: schema.ticketType.name, price: currentPriceCents(schema.ticketType.id) })
      .from(schema.ticketType)
      .where(eq(schema.ticketType.eventId, ev.id));
    if (types.length === 0) problems.push("Añade al menos un tipo de entrada");
    for (const t of types) if (t.price == null) problems.push(`«${t.name}» no tiene precio vigente`);

    const [counts] = await tx
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        unassigned: sql<number>`count(*) filter (where ${schema.seat.ticketTypeId} is null)`.mapWith(Number),
      })
      .from(schema.seat)
      .where(eq(schema.seat.eventId, ev.id));
    if (ev.seatingMode === "RESERVED") {
      if (counts.total === 0) problems.push("El plano no tiene asientos");
      else if (counts.unassigned > 0) problems.push(`${counts.unassigned} asiento(s) sin categoría en el plano`);
    } else if (counts.total === 0 && types.length > 0) {
      problems.push("El aforo total es 0");
    }
    return problems;
  }

  /**
   * Cambio numerado ↔ entrada general: solo si ninguna plaza tiene historial. Borra
   * las plazas actuales; en GENERAL regenera las de cada categoría con su `capacity`.
   */
  private async switchSeatingModeTx(
    tx: Tx,
    tenantId: string,
    ev: EventRow,
    mode: EventRow["seatingMode"],
  ) {
    const [{ used }] = await tx
      .select({ used: sql<number>`count(*) filter (where ${seatHasHistory})`.mapWith(Number) })
      .from(schema.seat)
      .where(eq(schema.seat.eventId, ev.id));
    if (used > 0) {
      throw new ConflictException("Ya hay reservas o ventas: no se puede cambiar el tipo de aforo");
    }
    await tx.delete(schema.seat).where(eq(schema.seat.eventId, ev.id));
    if (mode === "GENERAL") {
      const types = await tx
        .select({ id: schema.ticketType.id, capacity: schema.ticketType.capacity })
        .from(schema.ticketType)
        .where(eq(schema.ticketType.eventId, ev.id));
      for (const t of types) await syncGeneralSeats(tx, tenantId, ev.id, t.id, t.capacity ?? 0);
    }
  }

  private async loadTx(tx: Tx, eventId: string, forUpdate = false) {
    const q = tx.select().from(schema.event).where(eq(schema.event.id, eventId));
    const [ev] = forUpdate ? await q.for("update") : await q;
    if (!ev) throw new NotFoundException("Evento no encontrado");
    return ev;
  }

  private async assertVenueTx(tx: Tx, venueId: string) {
    const [v] = await tx.select({ id: schema.venue.id }).from(schema.venue).where(eq(schema.venue.id, venueId));
    if (!v) throw new BadRequestException("Recinto no encontrado");
  }

  private assertDates(e: Partial<EventRow>) {
    input.assertOrder(e.startsAt, e.endsAt, "La fecha de fin debe ser posterior al inicio");
    input.assertOrder(e.doorsAt, e.startsAt, "La apertura de puertas debe ser antes del inicio");
    input.assertOrder(e.salesStartAt, e.salesEndAt, "El fin de venta debe ser posterior a su inicio");
  }

  private parse(b: Record<string, unknown>, creating: boolean) {
    const data = input.defined({
      name: input.text(b.name, "Nombre", 200, creating) ?? undefined,
      summary: input.text(b.summary, "Resumen", 280),
      description: input.text(b.description, "Descripción", 20_000),
      category: input.text(b.category, "Categoría", 50),
      imageUrl: input.url(b.imageUrl, "Imagen"),
      timezone: input.timezone(b.timezone),
      startsAt: input.date(b.startsAt, "Inicio"),
      endsAt: input.date(b.endsAt, "Fin"),
      doorsAt: input.date(b.doorsAt, "Apertura de puertas"),
      visibility: input.oneOf(b.visibility, "Visibilidad", ["PUBLIC", "UNLISTED"] as const),
      seatingMode: input.oneOf(b.seatingMode, "Tipo de aforo", ["RESERVED", "GENERAL"] as const),
      salesStartAt: input.date(b.salesStartAt, "Inicio de venta"),
      salesEndAt: input.date(b.salesEndAt, "Fin de venta"),
      maxPerOrder: input.int(b.maxPerOrder, "Máximo por pedido", 1, 100, false) ?? undefined,
      minAge: input.int(b.minAge, "Edad mínima", 0, 99),
      refundPolicy: input.text(b.refundPolicy, "Política de devoluciones", 5_000),
      contactEmail: input.email(b.contactEmail, "Email de contacto"),
      confirmationMessage: input.text(b.confirmationMessage, "Mensaje de confirmación", 2_000),
      venueId: input.uuid(b.venueId, "Recinto"),
    });
    if (creating) this.assertDates(data);
    return data;
  }
}

const ACTION_TEXT: Record<StatusAction, string> = {
  publish: "publicar",
  unpublish: "despublicar",
  close: "cerrar la venta de",
  reopen: "reabrir",
  cancel: "cancelar",
};

const STATUS_TEXT: Record<EventRow["status"], string> = {
  DRAFT: "en borrador",
  ON_SALE: "a la venta",
  CLOSED: "con la venta cerrada",
  CANCELLED: "cancelado",
};
