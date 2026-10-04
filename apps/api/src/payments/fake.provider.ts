import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CreateIntentArgs,
  CreateIntentResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RefundResult,
} from "./payment-provider";

/**
 * Proveedor de pruebas. Reproduce el contrato real (incluida la verificación de
 * firma del webhook con HMAC) para poder probar el flujo completo —idempotencia
 * incluida— sin una cuenta de Stripe. NO usar en producción.
 *
 * Webhook esperado: cuerpo JSON {id, type, providerRef} y cabecera
 * `x-fake-signature: HMAC-SHA256(rawBody, FAKE_WEBHOOK_SECRET)`.
 */
export class FakeProvider implements PaymentProvider {
  readonly name = "fake";
  readonly idempotentRefunds = true;
  private readonly secret = process.env.FAKE_WEBHOOK_SECRET ?? "fake-webhook-secret";

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    return {
      providerRef: `fake_${args.orderId}`,
      clientSecret: `fake_cs_${args.orderId}`,
    };
  }

  /** En dev el cobro falso nunca está a medias: se puede cancelar siempre. */
  async cancelIntent(): Promise<"canceled"> {
    return "canceled";
  }

  /** En dev la devolución siempre sale bien al momento. */
  async refund(_providerRef: string, _amountCents: number, idempotencyKey: string): Promise<RefundResult> {
    return { providerRef: `fake_re_${idempotencyKey}`, status: "succeeded" };
  }

  verifyAndParse(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): PaymentWebhookEvent | null {
    const sig = headers["x-fake-signature"];
    if (!sig) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const body = JSON.parse(rawBody) as {
        id?: string;
        type?: string;
        providerRef?: string;
      };
      if (!body.id || !body.providerRef) return null;
      const type: PaymentWebhookEvent["type"] =
        body.type === "payment_succeeded"
          ? "payment_succeeded"
          : body.type === "payment_failed"
            ? "payment_failed"
            : "other";
      return { id: body.id, type, providerRef: body.providerRef };
    } catch {
      return null;
    }
  }
}
