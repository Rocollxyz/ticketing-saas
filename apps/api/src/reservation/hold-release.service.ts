import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { schema } from "@ticketing/database";
import { and, eq } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { PaymentRegistry } from "../payments/payment-registry";
import { SEATS_RELEASED, type SeatsReleasedEvent } from "../realtime/seat-events";

type Tx = Parameters<Parameters<AdminDb["db"]["transaction"]>[0]>[0];

/**
 * Libera reservas (holds) de forma SEGURA PARA EL DINERO. Una reserva con el pago ya
 * iniciado (tiene pedido + PaymentIntent) no se puede soltar sin más: si el comprador
 * paga justo después, Stripe cobraría y la plaza podría estar ya en otras manos
 * (cobrado sin entrada). Por eso, antes de liberar, se CANCELA el cobro en la
 * pasarela, y solo si la pasarela confirma "cancelado" se libera la plaza. Si dice
 * que ya se cobró (o está en proceso) la reserva se respeta y el webhook emitirá.
 *
 * Trabajo de sistema → AdminDb (fuera de RLS), como el sweeper. Quien la llama en
 * nombre de un comprador debe haber comprobado antes que la reserva es suya.
 */
@Injectable()
export class HoldReleaseService {
  private readonly logger = new Logger(HoldReleaseService.name);

  constructor(
    private readonly admin: AdminDb,
    private readonly emitter: EventEmitter2,
    private readonly payments: PaymentRegistry,
  ) {}

  /**
   * Libera un hold ACTIVE (`EXPIRED` al caducar, `RELEASED` si lo suelta el
   * comprador). Devuelve false si no se liberó (ya no estaba activo, o su cobro ya
   * se completó o sigue en proceso).
   */
  async release(holdId: string, status: "EXPIRED" | "RELEASED"): Promise<boolean> {
    const [h] = await this.admin.db
      .select({ id: schema.hold.id, status: schema.hold.status, orderId: schema.hold.orderId })
      .from(schema.hold)
      .where(eq(schema.hold.id, holdId));
    if (!h || h.status !== "ACTIVE") return false;
    if (h.orderId && !(await this.cancelPendingPayment(holdId, h.orderId))) return false;

    const released = await this.admin.db.transaction(async (tx) => {
      const [upd] = await tx
        .update(schema.hold)
        .set({ status })
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")))
        .returning({ id: schema.hold.id });
      if (!upd) return []; // otro proceso se adelantó (p.ej. el webhook la confirmó)
      if (h.orderId) await this.cancelOrderTx(tx, h.orderId);
      return tx
        .update(schema.holdSeat)
        .set({ status })
        .where(and(eq(schema.holdSeat.holdId, holdId), eq(schema.holdSeat.status, "ACTIVE")))
        .returning({ seatId: schema.holdSeat.seatId, eventId: schema.holdSeat.eventId });
    });

    if (released.length > 0) {
      this.emitter.emit(SEATS_RELEASED, {
        eventId: released[0].eventId,
        seatIds: released.map((r) => r.seatId),
      } satisfies SeatsReleasedEvent);
    }
    return released.length > 0;
  }

  /**
   * Suelta el cobro iniciado de un hold que SIGUE activo, para reintentar el pago con la
   * misma reserva (p. ej. Bizum falló y ahora paga con tarjeta). Misma regla que
   * `release`: solo si la pasarela confirma "cancelado". El pedido anterior queda
   * CANCELLED y el hold, sin pedido. Devuelve false si no se pudo (cobro en curso).
   */
  async detachPayment(holdId: string): Promise<boolean> {
    const [h] = await this.admin.db
      .select({ status: schema.hold.status, orderId: schema.hold.orderId })
      .from(schema.hold)
      .where(eq(schema.hold.id, holdId));
    if (!h || h.status !== "ACTIVE") return false;
    if (!h.orderId) return true;
    if (!(await this.cancelPendingPayment(holdId, h.orderId))) return false;

    return this.admin.db.transaction(async (tx) => {
      const [upd] = await tx
        .update(schema.hold)
        .set({ orderId: null })
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE"), eq(schema.hold.orderId, h.orderId!)))
        .returning({ id: schema.hold.id });
      if (!upd) return false; // otro proceso se adelantó (webhook, caducidad)
      await this.cancelOrderTx(tx, h.orderId!);
      return true;
    });
  }

  /** Cancela en la pasarela el cobro PENDING del pedido. true = ya no puede completarse. */
  private async cancelPendingPayment(holdId: string, orderId: string): Promise<boolean> {
    const [pay] = await this.admin.db
      .select({ provider: schema.payment.provider, ref: schema.payment.providerRef })
      .from(schema.payment)
      .where(and(eq(schema.payment.orderId, orderId), eq(schema.payment.status, "PENDING")));
    if (!pay) return true;
    const provider = this.payments.get(pay.provider);
    if (!provider) {
      this.logger.warn(`hold ${holdId}: pago con ${pay.provider}, pasarela no configurada`);
      return false;
    }
    // Red, FUERA de la transacción.
    const outcome = await provider.cancelIntent(pay.ref!);
    if (outcome !== "canceled") {
      this.logger.log(`hold ${holdId}: cobro ${outcome} — se mantiene la reserva hasta el webhook`);
      return false;
    }
    return true;
  }

  private async cancelOrderTx(tx: Tx, orderId: string) {
    await tx
      .update(schema.payment)
      .set({ status: "FAILED" })
      .where(and(eq(schema.payment.orderId, orderId), eq(schema.payment.status, "PENDING")));
    await tx
      .update(schema.order)
      .set({ status: "CANCELLED" })
      .where(and(eq(schema.order.id, orderId), eq(schema.order.status, "PENDING")));
  }
}
