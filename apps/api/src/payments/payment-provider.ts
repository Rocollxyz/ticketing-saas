/**
 * Capa de pagos por adaptadores (§3/§9). La API depende de esta interfaz, no de un
 * proveedor concreto. Implementaciones: FakeProvider (dev/test), StripeProvider
 * (Fase 2), RedsysProvider y TpvProvider (después).
 */

/** Cómo paga el comprador. Bizum solo lo ofrece Redsys. */
export type PaymentMethod = "card" | "bizum";

export interface CreateIntentArgs {
  orderId: string;
  amountCents: bigint;
  currency: string;
  method?: PaymentMethod;
  /** Pasarelas por redirección: adónde vuelve el comprador al pagar o al cancelar. */
  returnUrls?: { ok: string; ko: string };
  description?: string;
}

export interface CreateIntentResult {
  providerRef: string;
  /** Secreto para que el frontend complete el pago (en Stripe, client_secret). */
  clientSecret?: string;
  /** Pasarelas por redirección (Redsys): formulario que el navegador envía a `url`. */
  redirect?: { url: string; fields: Record<string, string> };
}

/** Evento de pago normalizado, ya verificado (firma comprobada). */
export interface PaymentWebhookEvent {
  /** id del evento en el proveedor — clave de idempotencia (§4). */
  id: string;
  /** refund_failed: una devolución que se dio por hecha falló después (providerRef = la devolución). */
  type: "payment_succeeded" | "payment_failed" | "refund_failed" | "other";
  providerRef: string;
  reason?: string;
  /** Importe cobrado según la pasarela, para comprobar que cuadra con el pedido. */
  amountCents?: number;
}

/**
 * Resultado de intentar cancelar un cobro en curso. Solo "canceled" garantiza que ese
 * cobro ya NO puede completarse; con "succeeded"/"processing" el dinero llega (o puede
 * llegar) y la reserva debe respetarse hasta el webhook.
 */
export type CancelOutcome = "canceled" | "succeeded" | "processing";

/** Resultado de pedir una devolución. "pending": la pasarela la completará más tarde. */
export interface RefundResult {
  providerRef: string;
  /** failed = rechazo CIERTO (no se devolvió nada). Un resultado desconocido se lanza como error. */
  status: "succeeded" | "pending" | "failed";
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /**
   * ¿Acepta clave de idempotencia en las devoluciones? Si no (Redsys), quien devuelve
   * debe evitar por su cuenta reenviar una devolución que pudo llegar a hacerse.
   */
  readonly idempotentRefunds: boolean;
  createIntent(args: CreateIntentArgs): Promise<CreateIntentResult>;
  /** Cancela el cobro si aún no se ha completado (al caducar o liberar la reserva). */
  cancelIntent(providerRef: string): Promise<CancelOutcome>;
  /**
   * Devuelve `amountCents` de un cobro completado. `idempotencyKey` (el id de nuestra
   * fila `refund`) garantiza que un reintento no devuelve el dinero dos veces.
   */
  refund(providerRef: string, amountCents: number, idempotencyKey: string): Promise<RefundResult>;
  /**
   * Verifica la firma del webhook y normaliza el evento. Devuelve null si la firma
   * no es válida (→ 400). Recibe el cuerpo CRUDO para poder verificar la firma.
   */
  verifyAndParse(rawBody: string, headers: Record<string, string | undefined>): PaymentWebhookEvent | null;
}
