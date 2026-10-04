import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { type BillingData, schema } from "@ticketing/database";
import { and, eq, inArray, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

/** Cupón aplicado a un pedido (se vuelve a comprobar, con bloqueo, al crearlo). */
interface AppliedCoupon {
  code: string;
  lines: PricedLine[];
}
import { AdminDb } from "../database/admin-db.service";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import type { PaymentMethod } from "../payments/payment-provider";
import { PaymentRegistry } from "../payments/payment-registry";
import { SEATS_SOLD, type SeatsSoldEvent } from "../realtime/seat-events";
import { validateAttendees } from "../catalog/attendee";
import { SIMPLIFIED_LIMIT_CENTS } from "../billing/tax";
import { type PricedLine, resolveCouponTx } from "../catalog/coupon";
import { currentPriceCents } from "../catalog/pricing";
import { eventSalesState, SALES_REASON_TEXT } from "../catalog/sales-rules";
import { listTx as listFieldsTx } from "../events/attendee-fields.service";
import { ReservationService } from "../reservation/reservation.service";

const CURRENCY = process.env.CURRENCY ?? "EUR";

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly admin: AdminDb,
    private readonly reservation: ReservationService,
    private readonly emitter: EventEmitter2,
    private readonly payments: PaymentRegistry,
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
    buyer: {
      name?: string | null;
      attendees?: unknown;
      couponCode?: string | null;
      billing?: BillingData | null;
      method?: PaymentMethod;
      /** Pasarelas por redirección: adónde vuelve el comprador (los arma la tienda). */
      returnUrls?: (orderId: string) => { ok: string; ko: string };
    } = {},
  ) {
    const method = buyer.method ?? "card";
    const provider = this.payments.forMethod(method);
    if (!provider) throw new BadRequestException("Método de pago no disponible");
    const tenantId = getStore()!.tenantId;

    // 1) Validar hold y calcular importe desde los precios reales (lectura).
    const { amountCents, discountCents, coupon } = await this.db.run(async (tx) => {
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
      const lines = await this.priceHoldTx(tx, h.id, seats.length);
      const subtotal = lines.reduce((acc, l) => acc + l.amountCents, 0);
      const code = buyer.couponCode?.trim();
      const applied = code ? await resolveCouponTx(tx, code, h.eventId, lines) : null;
      const discount = applied?.discountCents ?? 0;
      // Lo que se cobra por cada plaza (se copiará a la entrada): base de los reembolsos.
      for (const [i, l] of lines.entries()) {
        await tx
          .update(schema.holdSeat)
          .set({ priceCents: l.amountCents - (applied?.lineDiscounts[i] ?? 0) })
          .where(and(eq(schema.holdSeat.holdId, h.id), eq(schema.holdSeat.seatId, l.seatId!)));
      }
      return {
        amountCents: BigInt(subtotal - discount),
        discountCents: BigInt(discount),
        coupon: code ? { code, lines } : null,
      };
    });

    // Más de 400 €: la factura simplificada no vale (RD 1619/2012, art. 4) → hacen falta
    // los datos del comprador para la completa.
    if (amountCents > BigInt(SIMPLIFIED_LIMIT_CENTS) && !buyer.billing) {
      throw new BadRequestException(
        "Para compras de más de 400 € la ley exige factura completa: indica tus datos de facturación (NIF y dirección)",
      );
    }

    // Pedido GRATUITO (entradas a 0 €, o 100 % de descuento): nada que cobrar → se emite ya.
    const buyerName = buyer.name?.trim() || null;
    if (amountCents === 0n) return this.fulfillFreeOrder(holdId, buyerEmail, buyerName, coupon);

    const orderId = randomUUID();

    // 2) Crear el intent en el proveedor (red, fuera de transacción).
    const intent = await provider.createIntent({
      orderId,
      amountCents,
      currency: CURRENCY,
      method,
      returnUrls: buyer.returnUrls?.(orderId),
      description: "Entradas",
    });

    // 3) Persistir order + payment + enlazar el hold.
    await this.db.run(async (tx) => {
      const [h] = await tx
        .select()
        .from(schema.hold)
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")));
      if (!h) throw new ConflictException("El hold dejó de estar activo");

      const couponId = coupon ? await this.claimCouponTx(tx, coupon, h.eventId, discountCents) : null;
      await tx.insert(schema.order).values({
        id: orderId,
        tenantId,
        eventId: h.eventId,
        status: "PENDING",
        buyerEmail,
        buyerName,
        couponId,
        discountCents,
        billing: buyer.billing ?? null,
      });
      await tx.update(schema.hold).set({ orderId }).where(eq(schema.hold.id, h.id));
      await tx.insert(schema.payment).values({
        tenantId,
        orderId,
        provider: provider.name as "stripe" | "redsys" | "tpv",
        providerRef: intent.providerRef,
        amountCents,
        currency: CURRENCY,
        status: "PENDING",
      });
    });

    return {
      orderId,
      amountCents: amountCents.toString(),
      discountCents: discountCents.toString(),
      currency: CURRENCY,
      ...(intent.redirect
        ? { redirect: intent.redirect }
        : { clientSecret: intent.clientSecret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY }),
    };
  }

  /**
   * Presupuesto con un código de descuento sobre una SELECCIÓN (aún sin reservar), para
   * que la tienda muestre el total antes de comprar. No gasta el uso: eso se hace al
   * crear el pedido, donde todo se vuelve a comprobar.
   */
  async quote(eventId: string, selection: { seatIds?: string[]; quantities?: Record<string, number> }, code: string) {
    return this.db.run(async (tx) => {
      const lines: PricedLine[] = [];
      if (selection.quantities) {
        const ids = Object.keys(selection.quantities);
        const types = ids.length
          ? await tx
              .select({ id: schema.ticketType.id, amount: currentPriceCents(schema.ticketType.id) })
              .from(schema.ticketType)
              .where(and(eq(schema.ticketType.eventId, eventId), inArray(schema.ticketType.id, ids)))
          : [];
        for (const t of types) {
          const n = selection.quantities[t.id];
          if (!Number.isInteger(n) || n < 0 || n > 100) throw new BadRequestException("Cantidad inválida");
          for (let i = 0; i < n; i++) lines.push({ ticketTypeId: t.id, amountCents: Number(t.amount ?? 0) });
        }
      } else if (selection.seatIds?.length) {
        const seats = await tx
          .select({ ticketTypeId: schema.ticketType.id, amount: currentPriceCents(schema.ticketType.id) })
          .from(schema.seat)
          .innerJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
          .where(and(eq(schema.seat.eventId, eventId), inArray(schema.seat.id, selection.seatIds.slice(0, 100))));
        lines.push(...seats.map((s) => ({ ticketTypeId: s.ticketTypeId, amountCents: Number(s.amount ?? 0) })));
      }
      if (lines.length === 0) throw new BadRequestException("Elige primero tus entradas");
      const { coupon, discountCents } = await resolveCouponTx(tx, code, eventId, lines);
      const subtotal = lines.reduce((a, l) => a + l.amountCents, 0);
      return { code: coupon.code, subtotalCents: subtotal, discountCents, totalCents: subtotal - discountCents };
    });
  }

  /**
   * La pasarela avisa de que una devolución dada por hecha ha fallado: vuelve a FAILED
   * (visible en «Asistentes», reintentable) y el pago deja de contar como devuelto.
   */
  private async markRefundFailed(providerName: string, refundRef: string, reason?: string) {
    const [r] = await this.admin.db
      .select()
      .from(schema.refund)
      .where(eq(schema.refund.providerRef, refundRef))
      .limit(1);
    if (!r || r.status !== "SUCCEEDED") return { ignored: "devolución desconocida o no hecha" };
    this.logger.error(`devolución ${r.id} (${providerName}) FALLÓ después de darse por hecha: ${reason ?? "sin motivo"}`);
    await this.admin.db.transaction(async (tx) => {
      await tx
        .update(schema.refund)
        .set({
          status: "FAILED",
          error: `La pasarela no pudo completar la devolución${reason ? ` (${reason})` : ""}: reinténtala o devuélvela por otra vía`,
          updatedAt: new Date(),
        })
        .where(eq(schema.refund.id, r.id));
      if (r.paymentId) {
        await tx
          .update(schema.payment)
          .set({ status: "CAPTURED" })
          .where(and(eq(schema.payment.id, r.paymentId), eq(schema.payment.status, "REFUNDED")));
      }
      await tx.insert(schema.auditLog).values({
        tenantId: r.tenantId,
        action: "refund.failed_later",
        diff: { refundId: r.id, reason: reason ?? null },
      });
    });
    return { ok: true, refundFailed: r.id };
  }

  /** Estado de un pedido para la página de vuelta (sin datos personales). */
  orderStatus(orderId: string) {
    return this.db.run(async (tx) => {
      const [o] = await tx
        .select({ status: schema.order.status, eventId: schema.order.eventId })
        .from(schema.order)
        .where(eq(schema.order.id, orderId));
      if (!o) throw new NotFoundException("Pedido no encontrado");
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.ticket)
        .where(eq(schema.ticket.orderId, orderId));
      return { status: o.status, eventId: o.eventId, tickets: n };
    });
  }

  /** Precio vigente de cada plaza del hold. */
  private async priceHoldTx(tx: Tx, holdId: string, seatCount: number): Promise<PricedLine[]> {
    const priced = await tx
      .select({
        seatId: schema.holdSeat.seatId,
        ticketTypeId: schema.ticketType.id,
        amount: currentPriceCents(schema.ticketType.id),
      })
      .from(schema.holdSeat)
      .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
      .innerJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
      .where(eq(schema.holdSeat.holdId, holdId));
    if (priced.length !== seatCount || priced.some((p) => p.amount == null)) {
      throw new BadRequestException("Hay asientos sin precio asignado");
    }
    return priced.map((p) => ({ seatId: p.seatId, ticketTypeId: p.ticketTypeId, amountCents: Number(p.amount) }));
  }

  /**
   * Vuelve a validar el cupón BLOQUEANDO su fila (límite de usos sin carreras) dentro
   * de la transacción que crea el pedido. Si el descuento cambió entre el cálculo y
   * ahora (p.ej. se editó el cupón), se rechaza: el importe ya se pidió a la pasarela.
   */
  private async claimCouponTx(tx: Tx, c: AppliedCoupon, eventId: string, expected: bigint) {
    const { coupon, discountCents } = await resolveCouponTx(tx, c.code, eventId, c.lines, true);
    if (BigInt(discountCents) !== expected) {
      throw new ConflictException("El código de descuento ha cambiado; vuelve a aplicarlo");
    }
    return coupon.id;
  }

  /** Emite en el acto un pedido de importe 0 (mismo camino que un pago confirmado). */
  private async fulfillFreeOrder(
    holdId: string,
    buyerEmail?: string,
    buyerName?: string | null,
    coupon?: AppliedCoupon | null,
  ) {
    const tenantId = getStore()!.tenantId;
    const sold = await this.db.run(async (tx) => {
      const [h] = await tx
        .select()
        .from(schema.hold)
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")));
      if (!h) throw new ConflictException("El hold dejó de estar activo");
      const discountCents = coupon ? BigInt(coupon.lines.reduce((a, l) => a + l.amountCents, 0)) : 0n;
      const couponId = coupon ? await this.claimCouponTx(tx, coupon, h.eventId, discountCents) : null;
      const [o] = await tx
        .insert(schema.order)
        .values({ tenantId, eventId: h.eventId, status: "PAID", buyerEmail, buyerName, couponId, discountCents })
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
    const provider = this.payments.get(providerName);
    if (!provider) throw new NotFoundException("Proveedor desconocido");
    const evt = provider.verifyAndParse(rawBody, headers);
    if (!evt) throw new BadRequestException("Firma de webhook inválida");
    if (evt.type === "refund_failed") return this.markRefundFailed(providerName, evt.providerRef, evt.reason);
    if (evt.type !== "payment_succeeded") return { ignored: evt.type };

    // Resolver tenant/order por el pago — privilegiado, aún sin contexto de tenant.
    const [pay] = await this.admin.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.providerRef, evt.providerRef))
      .limit(1);
    if (!pay) return { ignored: "pago desconocido" };
    if (pay.provider !== providerName) return { ignored: "pasarela distinta" };
    // Defensa: lo cobrado debe ser lo que pedimos (un importe manipulado no emite nada).
    if (evt.amountCents != null && evt.amountCents !== Number(pay.amountCents)) {
      this.logger.error(`pago ${pay.id}: cobrado ${evt.amountCents} ≠ pedido ${pay.amountCents} — no se emite`);
      return { ignored: "importe distinto" };
    }

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
