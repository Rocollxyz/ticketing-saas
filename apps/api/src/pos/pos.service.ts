import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { schema } from "@ticketing/database";
import { eq, inArray } from "drizzle-orm";
import { currentPriceCents, seatTaken } from "../catalog/pricing";
import { seatLabel } from "../catalog/seat-label";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { SEATS_SOLD, type SeatsSoldEvent } from "../realtime/seat-events";
import { ReservationService } from "../reservation/reservation.service";
import { TPV_PROVIDER, type TpvProvider } from "./tpv.provider";

const CURRENCY = process.env.CURRENCY ?? "EUR";
const POS_ROLES = new Set(["taquillero", "promotor", "admin_saas"]);

export type PosMethod = "cash" | "card";

/**
 * POS de taquilla (Fase 5). Venta PRESENCIAL: el taquillero elige asientos, cobra en
 * efectivo o por datáfono (TpvProvider) y la entrada se emite EN EL ACTO (síncrono,
 * sin esperar webhook como en la venta online). Reutiliza el motor de reserva (misma
 * anti-sobreventa) y deja outbox + emite seats.sold para el tiempo real.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly db: TenantDb,
    private readonly reservation: ReservationService,
    private readonly emitter: EventEmitter2,
    @Inject(TPV_PROVIDER) private readonly tpv: TpvProvider,
  ) {}

  private assertRole() {
    if (!POS_ROLES.has(getStore()!.role)) {
      throw new ForbiddenException("Rol sin permiso de taquilla");
    }
  }

  /** Eventos a la venta del tenant. */
  listEvents() {
    this.assertRole();
    return this.db.run((tx) =>
      tx
        .select({
          id: schema.event.id,
          name: schema.event.name,
          status: schema.event.status,
          startsAt: schema.event.startsAt,
          seatingMode: schema.event.seatingMode,
        })
        .from(schema.event)
        .where(eq(schema.event.status, "ON_SALE"))
        .orderBy(schema.event.startsAt),
    );
  }

  /**
   * Lo que el POS necesita para vender: categorías con precio vigente y plazas libres
   * y, si el evento es NUMERADO, el plano con la disponibilidad de cada asiento.
   */
  seats(eventId: string) {
    this.assertRole();
    return this.db.run(async (tx) => {
      const [ev] = await tx
        .select({ id: schema.event.id, name: schema.event.name, seatingMode: schema.event.seatingMode })
        .from(schema.event)
        .where(eq(schema.event.id, eventId));
      if (!ev) throw new NotFoundException("Evento no encontrado");

      const seats = await tx
        .select({
          id: schema.seat.id,
          fila: schema.seat.fila,
          numero: schema.seat.numero,
          posX: schema.seat.posX,
          posY: schema.seat.posY,
          isGeneral: schema.seat.isGeneral,
          ticketTypeId: schema.seat.ticketTypeId,
          categoria: schema.ticketType.name,
          precioCents: currentPriceCents(schema.ticketType.id),
          ocupado: seatTaken(schema.seat.id),
        })
        .from(schema.seat)
        .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
        .where(eq(schema.seat.eventId, eventId));

      const types = await tx
        .select({
          id: schema.ticketType.id,
          name: schema.ticketType.name,
          precioCents: currentPriceCents(schema.ticketType.id),
        })
        .from(schema.ticketType)
        .where(eq(schema.ticketType.eventId, eventId))
        .orderBy(schema.ticketType.sortOrder, schema.ticketType.name);

      const free = new Map<string, number>();
      for (const s of seats) {
        if (s.ticketTypeId && !s.ocupado) free.set(s.ticketTypeId, (free.get(s.ticketTypeId) ?? 0) + 1);
      }

      return {
        event: ev,
        ticketTypes: types.map((t) => ({ ...t, disponibles: free.get(t.id) ?? 0 })),
        seats:
          ev.seatingMode === "RESERVED"
            ? seats
                .filter((s) => !s.isGeneral)
                .map((s) => ({
                  id: s.id,
                  fila: s.fila,
                  numero: s.numero,
                  posX: s.posX,
                  posY: s.posY,
                  categoria: s.categoria,
                  precioCents: s.precioCents,
                  disponible: !s.ocupado,
                }))
            : [],
      };
    });
  }

  /**
   * Venta presencial: reserva + cobro + emisión inmediata. Numerado → `seatIds`;
   * entrada general → `quantities` {ticketTypeId: n}.
   */
  async sell(
    eventId: string,
    selection: { seatIds?: string[]; quantities?: Record<string, number> },
    method: PosMethod,
    buyerEmail?: string,
  ) {
    this.assertRole();
    if (method !== "cash" && method !== "card") throw new BadRequestException("Método inválido");
    const tenantId = getStore()!.tenantId;
    const actor = `pos:${getStore()!.userId}`;

    // 1) Reserva (misma garantía anti-sobreventa; emite seats.held en tiempo real).
    const { holdId, seatIds } = selection.quantities
      ? await this.reservation.createHoldForQuantities(eventId, selection.quantities, actor, "pos")
      : await this.reservation.createHold(eventId, selection.seatIds ?? [], actor, "pos");

    // 2) Precio real desde la BD (fuera de la tx de escritura).
    const amountCents = await this.db.run((tx) => this.priceHoldTx(tx, holdId, seatIds.length));

    // 3) Cobro presencial. Tarjeta → datáfono; efectivo → lo cobra el taquillero.
    //    Importe 0 (invitaciones/entradas gratuitas): no se cobra nada.
    let providerRef = amountCents === 0n ? "GRATUITA" : "EFECTIVO";
    if (method === "card" && amountCents > 0n) {
      const charge = await this.tpv.charge(amountCents, CURRENCY);
      if (!charge.approved) throw new BadRequestException("Pago rechazado por el datáfono");
      providerRef = charge.ref;
    }

    // 4) order PAID + payment CAPTURED + emisión + outbox, atómico.
    const result = await this.db.run(async (tx) => {
      const [o] = await tx
        .insert(schema.order)
        .values({ tenantId, eventId, status: "PAID", buyerEmail })
        .returning();
      await tx.insert(schema.payment).values({
        tenantId,
        orderId: o.id,
        provider: method === "card" && amountCents > 0n ? "tpv" : "cash",
        providerRef,
        amountCents,
        currency: CURRENCY,
        status: "CAPTURED",
      });
      const tickets = await this.reservation.issueHoldForPosTx(tx, holdId, o.id);
      await tx.insert(schema.outbox).values([
        { tenantId, type: "ticket.issued", payload: { orderId: o.id, ticketIds: tickets.map((t) => t.ticketId) } },
        { tenantId, type: "invoice.issue", payload: { orderId: o.id } },
      ]);

      const labels = await tx
        .select({
          id: schema.seat.id,
          fila: schema.seat.fila,
          numero: schema.seat.numero,
          isGeneral: schema.seat.isGeneral,
          categoria: schema.ticketType.name,
        })
        .from(schema.seat)
        .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
        .where(inArray(schema.seat.id, seatIds));
      const labelOf = new Map(labels.map((l) => [l.id, seatLabel(l)]));

      return {
        orderId: o.id,
        tickets: tickets.map((t) => ({ ticketId: t.ticketId, seat: labelOf.get(t.seatId) ?? "?", qr: t.qr })),
      };
    });

    // 5) Tiempo real: los asientos quedan vendidos.
    this.emitter.emit(SEATS_SOLD, { eventId, seatIds } satisfies SeatsSoldEvent);

    return {
      orderId: result.orderId,
      method,
      amountCents: amountCents.toString(),
      currency: CURRENCY,
      providerRef,
      tickets: result.tickets,
    };
  }

  private async priceHoldTx(
    tx: Parameters<Parameters<TenantDb["run"]>[0]>[0],
    holdId: string,
    seatCount: number,
  ): Promise<bigint> {
    const priced = await tx
      .select({ id: schema.holdSeat.id, amount: currentPriceCents(schema.ticketType.id) })
      .from(schema.holdSeat)
      .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
      .innerJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
      .where(eq(schema.holdSeat.holdId, holdId));
    if (priced.length !== seatCount || priced.some((p) => p.amount == null)) {
      throw new BadRequestException("Hay asientos sin precio asignado");
    }
    // Lo cobrado por cada plaza (se copia a la entrada): base de los reembolsos.
    for (const p of priced) {
      await tx.update(schema.holdSeat).set({ priceCents: p.amount }).where(eq(schema.holdSeat.id, p.id));
    }
    return priced.reduce((acc, r) => acc + BigInt(r.amount!), 0n);
  }
}
