import Stripe from "stripe";
import {
  CancelOutcome,
  CreateIntentArgs,
  CreateIntentResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RefundResult,
} from "./payment-provider";

/**
 * StripeProvider (Fase 2). Crea PaymentIntents y verifica webhooks con la firma de
 * Stripe. Requiere STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET (secret manager en
 * prod, §7). El webhook necesita el body CRUDO para `constructEvent`.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly idempotentRefunds = true;
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "StripeProvider requiere STRIPE_SECRET_KEY. Usa PAYMENTS_PROVIDER=fake en dev.",
      );
    }
    this.stripe = new Stripe(key);
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: Number(args.amountCents),
      currency: args.currency.toLowerCase(),
      metadata: { orderId: args.orderId },
      automatic_payment_methods: { enabled: true },
    });
    return {
      providerRef: intent.id,
      clientSecret: intent.client_secret ?? undefined,
    };
  }

  async cancelIntent(providerRef: string): Promise<CancelOutcome> {
    const outcomeOf = (s: Stripe.PaymentIntent.Status): CancelOutcome | null =>
      s === "succeeded" ? "succeeded" : s === "processing" ? "processing" : s === "canceled" ? "canceled" : null;
    const current = await this.stripe.paymentIntents.retrieve(providerRef);
    const known = outcomeOf(current.status);
    if (known) return known;
    try {
      await this.stripe.paymentIntents.cancel(providerRef, { cancellation_reason: "abandoned" });
      return "canceled";
    } catch (e) {
      // Carrera: el comprador confirmó justo ahora. Manda el estado real en Stripe.
      const after = await this.stripe.paymentIntents.retrieve(providerRef);
      const outcome = outcomeOf(after.status);
      if (outcome) return outcome;
      throw e;
    }
  }

  async refund(providerRef: string, amountCents: number, idempotencyKey: string): Promise<RefundResult> {
    const r = await this.stripe.refunds.create(
      { payment_intent: providerRef, amount: amountCents, reason: "requested_by_customer" },
      { idempotencyKey: `refund_${idempotencyKey}` },
    );
    const status = r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "canceled" ? "failed" : "pending";
    return { providerRef: r.id, status };
  }

  verifyAndParse(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PaymentWebhookEvent | null {
    const sig = headers["stripe-signature"];
    if (!sig || !this.webhookSecret) return null;

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
    } catch {
      return null; // firma inválida → 400
    }

    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const intent = event.data.object as Stripe.PaymentIntent;
      return {
        id: event.id,
        type:
          event.type === "payment_intent.succeeded"
            ? "payment_succeeded"
            : "payment_failed",
        providerRef: intent.id,
      };
    }
    // Devolución que falla después de darse por hecha (p. ej. tarjeta cancelada).
    if (event.type === "refund.failed" || event.type === "refund.updated" || event.type === "charge.refund.updated") {
      const refund = event.data.object as Stripe.Refund;
      if (refund.status === "failed") {
        return { id: event.id, type: "refund_failed", providerRef: refund.id, reason: refund.failure_reason ?? undefined };
      }
    }
    return { id: event.id, type: "other", providerRef: "" };
  }
}
