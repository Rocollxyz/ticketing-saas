import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { schema } from "@ticketing/database";
import { and, eq } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";
import { SEATS_RELEASED, type SeatsReleasedEvent } from "../realtime/seat-events";

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
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
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

    if (h.orderId) {
      const [pay] = await this.admin.db
        .select({ provider: schema.payment.provider, ref: schema.payment.providerRef })
        .from(schema.payment)
        .where(and(eq(schema.payment.orderId, h.orderId), eq(schema.payment.status, "PENDING")));
      if (pay) {
        if (pay.provider !== this.provider.name) {
          this.logger.warn(`hold ${holdId}: pago con ${pay.provider}, no se puede cancelar desde ${this.provider.name}`);
          return false;
        }
        // Red, FUERA de la transacción.
        const outcome = await this.provider.cancelIntent(pay.ref!);
        if (outcome !== "canceled") {
          this.logger.log(`hold ${holdId}: cobro ${outcome} — se mantiene la reserva hasta el webhook`);
          return false;
        }
      }
    }

    const released = await this.admin.db.transaction(async (tx) => {
      const [upd] = await tx
        .update(schema.hold)
        .set({ status })
        .where(and(eq(schema.hold.id, holdId), eq(schema.hold.status, "ACTIVE")))
        .returning({ id: schema.hold.id });
      if (!upd) return []; // otro proceso se adelantó (p.ej. el webhook la confirmó)
      if (h.orderId) {
        await tx
          .update(schema.payment)
          .set({ status: "FAILED" })
          .where(and(eq(schema.payment.orderId, h.orderId), eq(schema.payment.status, "PENDING")));
        await tx
          .update(schema.order)
          .set({ status: "CANCELLED" })
          .where(and(eq(schema.order.id, h.orderId), eq(schema.order.status, "PENDING")));
      }
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
}
