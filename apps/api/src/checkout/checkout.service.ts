import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { schema } from "@ticketing/database";
import { and, eq } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { PAYMENT_PROVIDER, PaymentProvider } from "../payments/payment-provider";
import { SEATS_SOLD, type SeatsSoldEvent } from "../realtime/seat-events";
import { validateAttendees } from "../catalog/attendee";
import { currentPriceCents } from "../catalog/pricing";
import { eventSalesState, SALES_REASON_TEXT } from "../catalog/sales-rules";
import { listTx as listFieldsTx } from "../events/attendee-fields.service";
import { ReservationService } from "../reservation/reservation.service";

const CURRENCY = process.env.CURRENCY ?? "EUR";

@Injectable()
export class CheckoutService {
  constructor(
    private readonly db: TenantDb,
    private readonly admin: AdminDb,
    private readonly reservation: ReservationService,
    private readonly emitter: EventEmitter2,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Inicia el pago de un hold activo: valida el hold, crea el PaymentIntent en el
   * proveedor (fuera de la transacción, es I/O de red) y persiste order PENDING +
   * payment PENDING. Devuelve el clientSecret para que el frontend cobre.
   */
  /**
   * `buyer.attendees`: datos de cada asistente [{seatId, values:{fieldId: valor}}],
   * validados contra el formulario del evento y guardados en cada plaza reservada.
   */
  async createCheckout(
    holdId: string,
    buyerEmail?: string,
    buyer: { name?: string | null; attendees?: unknown } = {},
  ) {
    const tenantId = getStore()!.tenantId;

    // 1) Validar hold y calcular importe desde los precios reales (lectura).
    const { amountCents } = await this.db.run(async (tx) => {
      const [h] = await tx
        .select()
        .from(schema.hold)
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")));
      if (!h) throw new NotFoundException("Hold inexistente o no activo");
      if (h.expiresAt.getTime() < Date.now()) {
        throw new ConflictException("El hold ha expirado");
      }
      if (h.orderId) throw new BadRequestException("El hold ya tiene un pago iniciado");

      // El evento pudo cancelarse/cerrarse después de reservar: no se cobra.
      const [ev] = await tx.select().from(schema.event).where(eq(schema.event.id, h.eventId));
      const st = eventSalesState(ev);
      if (!st.open) throw new ConflictException(SALES_REASON_TEXT[st.reason]);

      const seats = await tx
        .select({ seatId: schema.holdSeat.seatId, ticketTypeId: schema.seat.ticketTypeId })
        .from(schema.holdSeat)
        .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
        .where(eq(schema.holdSeat.holdId, h.id))
        .orderBy(schema.seat.numero);

      // Datos de los asistentes (si el evento tiene formulario): se validan TODOS antes
      // de cobrar y se guardan en la plaza; se copiarán a la entrada al emitirla.
      const fields = await listFieldsTx(tx, h.eventId);
      if (fields.length) {
        const answers = validateAttendees(fields, seats, buyer.attendees);
        for (const [seatId, attendee] of answers) {
          await tx
            .update(schema.holdSeat)
            .set({ attendee })
            .where(and(eq(schema.holdSeat.holdId, h.id), eq(schema.holdSeat.seatId, seatId)));
        }
      }

      // Precio VIGENTE por asiento (anticipada/normal) vía su categoría. Queda fijado
      // aquí: es el importe del PaymentIntent aunque la anticipada caduque al pagar.
      const priced = await tx
        .select({ seatId: schema.seat.id, amount: currentPriceCents(schema.ticketType.id) })
        .from(schema.holdSeat)
        .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
        .innerJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
        .where(eq(schema.holdSeat.holdId, h.id));

      if (priced.length !== seats.length || priced.some((p) => p.amount == null)) {
        throw new BadRequestException("Hay asientos sin precio asignado");
      }
      const total = priced.reduce((acc, r) => acc + BigInt(r.amount!), 0n);
      return { amountCents: total };
    });

    // Pedido GRATUITO (entradas a 0 €): no hay nada que cobrar → se emite ya.
    const buyerName = buyer.name?.trim() || null;
    if (amountCents === 0n) return this.fulfillFreeOrder(holdId, buyerEmail, buyerName);

    const orderId = randomUUID();

    // 2) Crear el intent en el proveedor (red, fuera de transacción).
    const intent = await this.provider.createIntent({ orderId, amountCents, currency: CURRENCY });

    // 3) Persistir order + payment + enlazar el hold.
    await this.db.run(async (tx) => {
      const [h] = await tx
        .select()
        .from(schema.hold)
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")));
      if (!h) throw new ConflictException("El hold dejó de estar activo");

      await tx
        .insert(schema.order)
        .values({ id: orderId, tenantId, eventId: h.eventId, status: "PENDING", buyerEmail, buyerName });
      await tx.update(schema.hold).set({ orderId }).where(eq(schema.hold.id, h.id));
      await tx.insert(schema.payment).values({
        tenantId,
        orderId,
        provider: this.provider.name as "stripe" | "redsys" | "tpv",
        providerRef: intent.providerRef,
        amountCents,
        currency: CURRENCY,
        status: "PENDING",
      });
    });

    return {
      orderId,
      amountCents: amountCents.toString(),
      currency: CURRENCY,
      clientSecret: intent.clientSecret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }

  /** Emite en el acto un pedido de importe 0 (mismo camino que un pago confirmado). */
  private async fulfillFreeOrder(holdId: string, buyerEmail?: string, buyerName?: string | null) {
    const tenantId = getStore()!.tenantId;
    const sold = await this.db.run(async (tx) => {
      const [h] = await tx
        .select()
        .from(schema.hold)
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")));
      if (!h) throw new ConflictException("El hold dejó de estar activo");
      const [o] = await tx
        .insert(schema.order)
        .values({ tenantId, eventId: h.eventId, status: "PAID", buyerEmail, buyerName })
        .returning();
      await tx.update(schema.hold).set({ orderId: o.id }).where(eq(schema.hold.id, h.id));
      const { eventId, tickets } = await this.reservation.fulfillPaidOrderTx(tx, tenantId, o.id);
      return { orderId: o.id, eventId, seatIds: tickets.map((t) => t.seatId) };
    });
    this.emitter.emit(SEATS_SOLD, { eventId: sold.eventId, seatIds: sold.seatIds } satisfies SeatsSoldEvent);
    return { orderId: sold.orderId, amountCents: "0", currency: CURRENCY, free: true };
  }

  /**
   * Procesa un webhook de pago. Verifica firma (en el provider), resuelve el tenant
   * por el pago (vía AdminDb, sin contexto) y cumple el pedido de forma IDEMPOTENTE:
   * la inserción en processed_webhook_event con ON CONFLICT DO NOTHING es la guarda
   * — si el evento ya se procesó, no se re-emite (§4).
   */
  async handleWebhook(
    providerName: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ) {
    if (providerName !== this.provider.name) {
      throw new NotFoundException("Proveedor desconocido");
    }
    const evt = this.provider.verifyAndParse(rawBody, headers);
    if (!evt) throw new BadRequestException("Firma de webhook inválida");
    if (evt.type !== "payment_succeeded") return { ignored: evt.type };

    // Resolver tenant/order por el pago — privilegiado, aún sin contexto de tenant.
    const [pay] = await this.admin.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.providerRef, evt.providerRef))
      .limit(1);
    if (!pay) return { ignored: "pago desconocido" };

    const result = await this.db.runAs(pay.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.processedWebhookEvent)
        .values({ provider: providerName, eventId: evt.id })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        return { sold: null }; // reintento ya procesado: nada que emitir
      }

      await tx
        .update(schema.payment)
        .set({ status: "CAPTURED" })
        .where(eq(schema.payment.id, pay.id));
      await tx
        .update(schema.order)
        .set({ status: "PAID" })
        .where(eq(schema.order.id, pay.orderId));

      const { eventId, tickets } = await this.reservation.fulfillPaidOrderTx(
        tx,
        pay.tenantId,
        pay.orderId,
      );
      return { sold: { eventId, seatIds: tickets.map((t) => t.seatId) } };
    });

    // Tras COMMIT: si se emitieron entradas (no era un reintento ya procesado),
    // notifica a los compradores en vivo que esos asientos quedaron VENDIDOS.
    if (result.sold && result.sold.seatIds.length > 0) {
      this.emitter.emit(SEATS_SOLD, result.sold satisfies SeatsSoldEvent);
    }

    return result.sold
      ? { ok: true, issued: result.sold.seatIds.length }
      : { ok: true, alreadyProcessed: true };
  }
}
