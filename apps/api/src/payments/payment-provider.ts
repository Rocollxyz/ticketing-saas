/**
 * Capa de pagos por adaptadores (§3/§9). La API depende de esta interfaz, no de un
 * proveedor concreto. Implementaciones: FakeProvider (dev/test), StripeProvider
 * (Fase 2), RedsysProvider y TpvProvider (después).
 */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export interface CreateIntentArgs {
  orderId: string;
  amountCents: bigint;
  currency: string;
}

export interface CreateIntentResult {
  providerRef: string;
  /** Secreto para que el frontend complete el pago (en Stripe, client_secret). */
  clientSecret?: string;
}

/** Evento de pago normalizado, ya verificado (firma comprobada). */
export interface PaymentWebhookEvent {
  /** id del evento en el proveedor — clave de idempotencia (§4). */
  id: string;
  type: "payment_succeeded" | "payment_failed" | "other";
  providerRef: string;
}

/**
 * Resultado de intentar cancelar un cobro en curso. Solo "canceled" garantiza que ese
 * cobro ya NO puede completarse; con "succeeded"/"processing" el dinero llega (o puede
 * llegar) y la reserva debe respetarse hasta el webhook.
 */
export type CancelOutcome = "canceled" | "succeeded" | "processing";

export interface PaymentProvider {
  readonly name: string;
  createIntent(args: CreateIntentArgs): Promise<CreateIntentResult>;
  /** Cancela el cobro si aún no se ha completado (al caducar o liberar la reserva). */
  cancelIntent(providerRef: string): Promise<CancelOutcome>;
  /**
   * Verifica la firma del webhook y normaliza el evento. Devuelve null si la firma
   * no es válida (→ 400). Recibe el cuerpo CRUDO para poder verificar la firma.
   */
  verifyAndParse(rawBody: string, headers: Record<string, string | undefined>): PaymentWebhookEvent | null;
}
