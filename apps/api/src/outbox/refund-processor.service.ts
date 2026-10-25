import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, ne, sql } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { PaymentRegistry } from "../payments/payment-registry";
import { EMAIL_PROVIDER, type EmailProvider } from "./email-provider";

/** Marca de «devolución enviada, respuesta pendiente» (pasarelas sin idempotencia). */
export const SENDING = "sending";

const euros = (c: number) => (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/**
 * Envía las devoluciones a la pasarela (tipo de outbox `refund.process`) y gestiona
 * los cobros sin plaza (`order.refund_required`). Trabajo de sistema → AdminDb.
 *
 * Seguro ante reintentos: la pasarela recibe el id de nuestra fila `refund` como clave
 * de idempotencia, así que repetir el envío nunca devuelve el dinero dos veces. Un
 * error de la pasarela deja la devolución FAILED (visible en la consola, reintentable)
 * en vez de reintentar en bucle.
 */
@Injectable()
export class RefundProcessorService {
  private readonly logger = new Logger(RefundProcessorService.name);

  constructor(
    private readonly admin: AdminDb,
    private readonly payments: PaymentRegistry,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async process(refundId: string) {
    const db = this.admin.db;
    const [r] = await db.select().from(schema.refund).where(eq(schema.refund.id, refundId));
    if (!r || r.status !== "PENDING") return; // ya procesada (o reintento duplicado)
    const [pay] = r.paymentId ? await db.select().from(schema.payment).where(eq(schema.payment.id, r.paymentId)) : [];

    // `cleared`: rechazo cierto (no se devolvió nada) → fuera la marca de envío.
    const fail = (error: string, cleared = false) =>
      db
        .update(schema.refund)
        .set({ status: "FAILED", error, updatedAt: new Date(), ...(cleared ? { providerRef: null } : {}) })
        .where(eq(schema.refund.id, r.id));
    if (!pay?.providerRef) return fail("El pedido no tiene un cobro online");
    const provider = this.payments.get(pay.provider);
    if (!provider) return fail(`La pasarela ${pay.provider} no está configurada`);

    // Pasarela sin idempotencia: se deja marca ANTES de llamar. Si al reintentar la marca
    // sigue ahí, la devolución pudo hacerse: no se reenvía (mejor revisar que pagar dos veces).
    if (!provider.idempotentRefunds) {
      if (r.providerRef === SENDING) {
        return fail(
          "Se envió a la pasarela pero no consta la respuesta: comprueba en su panel si se devolvió antes de reintentar",
        );
      }
      await db.update(schema.refund).set({ providerRef: SENDING }).where(eq(schema.refund.id, r.id));
    }

    let result;
    try {
      result = await provider.refund(pay.providerRef, r.amountCents, r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`devolución ${r.id} falló: ${msg}`);
      // Sin respuesta clara: en una pasarela sin idempotencia pudo llegar a devolverse.
      return fail(
        provider.idempotentRefunds
          ? msg.slice(0, 500)
          : `No consta la respuesta de la pasarela (${msg.slice(0, 200)}): comprueba en su panel si se devolvió antes de reintentar`,
      );
    }
    if (result.status === "failed") return fail(result.reason ?? "La pasarela ha rechazado la devolución", true);

    // "pending" (Stripe la completa en segundo plano) se da por hecha: casi nunca falla
    // después. Ver hueco en PENDIENTES (seguimiento por webhook).
    await db.transaction(async (tx) => {
      await tx
        .update(schema.refund)
        .set({ status: "SUCCEEDED", providerRef: result.providerRef, error: null, updatedAt: new Date() })
        .where(eq(schema.refund.id, r.id));
      const [{ total }] = await tx
        .select({ total: sql<number>`coalesce(sum(${schema.refund.amountCents}), 0)`.mapWith(Number) })
        .from(schema.refund)
        .where(and(eq(schema.refund.paymentId, pay.id), eq(schema.refund.status, "SUCCEEDED")));
      if (total >= Number(pay.amountCents)) {
        await tx.update(schema.payment).set({ status: "REFUNDED" }).where(eq(schema.payment.id, pay.id));
      }
      // Factura rectificativa de lo devuelto (si el pedido se facturó).
      await tx.insert(schema.outbox).values({ tenantId: r.tenantId, type: "invoice.rectify", payload: { refundId: r.id } });
    });
    await this.notify(r.orderId, r.amountCents, r.ticketIds.length, r.reason);
  }

  /**
   * Cobro sin plaza (la reserva caducó y otro se quedó la plaza): se devuelve TODO lo
   * cobrado, sin intervención del promotor.
   */
  async refundRequired(tenantId: string | null, orderId: string) {
    const db = this.admin.db;
    const [pay] = await db
      .select()
      .from(schema.payment)
      .where(and(eq(schema.payment.orderId, orderId), eq(schema.payment.status, "CAPTURED")))
      .limit(1);
    if (!pay) {
      this.logger.warn(`cobro sin plaza ${orderId}: no hay pago cobrado (¿aún no ha llegado?)`);
      throw new Error("pago aún no capturado"); // se reintenta en el siguiente ciclo
    }
    const [{ already }] = await db
      .select({ already: sql<number>`coalesce(sum(${schema.refund.amountCents}), 0)`.mapWith(Number) })
      .from(schema.refund)
      .where(and(eq(schema.refund.orderId, orderId), ne(schema.refund.status, "FAILED")));
    const amount = Number(pay.amountCents) - already;
    if (amount <= 0) return;
    const [r] = await db
      .insert(schema.refund)
      .values({
        tenantId: tenantId ?? pay.tenantId,
        orderId,
        paymentId: pay.id,
        amountCents: amount,
        status: "PENDING",
        // Caducó y otro se quedó la plaza, o el comprador ya la pagó con otro intento.
        reason: "Cobrado sin plaza: la reserva ya no correspondía a este pago",
      })
      .returning();
    await this.process(r.id);
  }

  /** Email al comprador. Si falla, la devolución ya está hecha: solo se registra. */
  private async notify(orderId: string, amountCents: number, tickets: number, reason: string | null) {
    try {
      const [o] = await this.admin.db
        .select({ to: schema.order.buyerEmail, name: schema.order.buyerName, event: schema.event.name })
        .from(schema.order)
        .innerJoin(schema.event, eq(schema.event.id, schema.order.eventId))
        .where(eq(schema.order.id, orderId));
      if (!o?.to) return;
      await this.email.send({
        to: o.to,
        subject: `Devolución de ${euros(amountCents)} — ${o.event}`,
        text:
          `${o.name ? `Hola ${o.name},\n\n` : ""}` +
          `Te hemos devuelto ${euros(amountCents)} de tu pedido para ${o.event}` +
          (tickets === 1 ? " (1 entrada, que queda anulada)" : tickets > 1 ? ` (${tickets} entradas, que quedan anuladas)` : "") +
          `.\n` +
          (reason ? `Motivo: ${reason}\n` : "") +
          `\nEl dinero vuelve al mismo medio de pago; según tu banco puede tardar de 5 a 10 días en aparecer.\n`,
      });
    } catch (e) {
      this.logger.error(`aviso de devolución del pedido ${orderId} no enviado: ${e instanceof Error ? e.message : e}`);
    }
  }
}
