import { createCipheriv, createHmac, timingSafeEqual } from "node:crypto";
import type {
  CancelOutcome,
  CreateIntentArgs,
  CreateIntentResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RefundResult,
} from "./payment-provider";

const URLS = {
  test: { pay: "https://sis-t.redsys.es:25443/sis/realizarPago", rest: "https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST" },
  prod: { pay: "https://sis.redsys.es/sis/realizarPago", rest: "https://sis.redsys.es/sis/rest/trataPeticionREST" },
};

const SIGNATURE_VERSION = "HMAC_SHA256_V1";
const CURRENCY_CODE: Record<string, string> = { EUR: "978" };

/** Base64 estándar → base64url (Redsys firma las notificaciones en base64url). */
const toUrl = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_");

/**
 * Firma HMAC_SHA256_V1 de Redsys: la clave del comercio (base64) cifra con 3DES-CBC (IV a
 * ceros, relleno con ceros) el número de pedido; con eso se hace HMAC-SHA256 de los
 * parámetros (el JSON en base64). Devuelve la firma en base64 estándar.
 */
export function redsysSignature(secretB64: string, order: string, merchantParamsB64: string): string {
  const key = Buffer.from(secretB64, "base64");
  const data = Buffer.from(order, "utf8");
  const padded = Buffer.concat([data, Buffer.alloc((8 - (data.length % 8)) % 8)]);
  const cipher = createCipheriv("des-ede3-cbc", key, Buffer.alloc(8));
  cipher.setAutoPadding(false);
  const derived = Buffer.concat([cipher.update(padded), cipher.final()]);
  return createHmac("sha256", derived).update(merchantParamsB64).digest("base64");
}

/**
 * Número de pedido para Redsys: 12 caracteres, los 4 primeros numéricos (requisito del
 * TPV), único por comercio. Es la referencia del pago (`providerRef`).
 */
export function redsysOrderCode(orderId: string): string {
  const digits = String(Date.now() % 10_000).padStart(4, "0");
  return `${digits}${orderId.replace(/-/g, "").slice(0, 8)}`.toUpperCase();
}

/**
 * Redsys (TPV virtual de la banca española): tarjeta y Bizum por REDIRECCIÓN. El
 * comprador paga en la página de Redsys; el resultado llega firmado por la notificación
 * (webhook) y también en la URL de vuelta a la tienda (respaldo: la notificación no
 * llega a un servidor local). Devoluciones por la API REST (TransactionType 3).
 *
 * Config: REDSYS_MERCHANT_CODE, REDSYS_TERMINAL, REDSYS_SECRET (clave SHA-256 del
 * terminal), REDSYS_ENV=test|prod, PUBLIC_API_URL (para la notificación).
 */
export class RedsysProvider implements PaymentProvider {
  readonly name = "redsys";
  readonly idempotentRefunds = false; // su API REST no admite clave de idempotencia
  private readonly merchant = process.env.REDSYS_MERCHANT_CODE ?? "";
  private readonly terminal = process.env.REDSYS_TERMINAL ?? "1";
  private readonly secret = process.env.REDSYS_SECRET ?? "";
  private readonly urls = process.env.REDSYS_ENV === "prod" ? URLS.prod : URLS.test;

  constructor() {
    if (!this.merchant || !this.secret) {
      throw new Error("RedsysProvider requiere REDSYS_MERCHANT_CODE y REDSYS_SECRET");
    }
  }

  private sign(params: Record<string, string>) {
    const b64 = Buffer.from(JSON.stringify(params), "utf8").toString("base64");
    const order = params.DS_MERCHANT_ORDER;
    return {
      Ds_SignatureVersion: SIGNATURE_VERSION,
      Ds_MerchantParameters: b64,
      Ds_Signature: redsysSignature(this.secret, order, b64),
    };
  }

  /** Verifica unos parámetros firmados por Redsys y los devuelve decodificados. */
  private verify(paramsB64: string, signature: string): Record<string, string> | null {
    let params: Record<string, string>;
    try {
      params = JSON.parse(Buffer.from(paramsB64, "base64").toString("utf8"));
    } catch {
      return null;
    }
    const order = params.Ds_Order ?? params.DS_ORDER;
    if (!order) return null;
    const expected = Buffer.from(toUrl(redsysSignature(this.secret, order, paramsB64)));
    const got = Buffer.from(toUrl(signature));
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const code = params.Ds_MerchantCode ?? params.DS_MERCHANTCODE;
    if (code && code !== this.merchant) return null;
    return params;
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    const order = redsysOrderCode(args.orderId);
    const base = process.env.PUBLIC_API_URL ?? "http://localhost:3000";
    const params: Record<string, string> = {
      DS_MERCHANT_AMOUNT: String(args.amountCents),
      DS_MERCHANT_ORDER: order,
      DS_MERCHANT_MERCHANTCODE: this.merchant,
      DS_MERCHANT_CURRENCY: CURRENCY_CODE[args.currency] ?? "978",
      DS_MERCHANT_TRANSACTIONTYPE: "0",
      DS_MERCHANT_TERMINAL: this.terminal,
      DS_MERCHANT_MERCHANTURL: `${base}/webhooks/redsys`,
      DS_MERCHANT_CONSUMERLANGUAGE: "001",
      ...(args.description ? { DS_MERCHANT_PRODUCTDESCRIPTION: args.description.slice(0, 125) } : {}),
      ...(args.returnUrls ? { DS_MERCHANT_URLOK: args.returnUrls.ok, DS_MERCHANT_URLKO: args.returnUrls.ko } : {}),
      // Bizum: el comprador paga con su móvil en la página de Redsys.
      ...(args.method === "bizum" ? { DS_MERCHANT_PAYMETHODS: "z" } : {}),
    };
    return { providerRef: order, redirect: { url: this.urls.pay, fields: this.sign(params) } };
  }

  /**
   * En Redsys no hay un cobro «a medias» que cancelar: si el comprador no paga, no hay
   * nada. Si pagara justo después de liberar la reserva, el pedido entra por el camino
   * de «cobrado sin plaza» y se devuelve solo.
   */
  async cancelIntent(): Promise<CancelOutcome> {
    return "canceled";
  }

  async refund(providerRef: string, amountCents: number): Promise<RefundResult> {
    const body = this.sign({
      DS_MERCHANT_AMOUNT: String(amountCents),
      DS_MERCHANT_ORDER: providerRef,
      DS_MERCHANT_MERCHANTCODE: this.merchant,
      DS_MERCHANT_CURRENCY: "978",
      DS_MERCHANT_TRANSACTIONTYPE: "3",
      DS_MERCHANT_TERMINAL: this.terminal,
    });
    const r = await fetch(this.urls.rest, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as Record<string, string> | null;
    if (!json) throw new Error(`Redsys respondió ${r.status}`);
    if (json.errorCode) {
      return { providerRef, status: "failed", reason: `Redsys rechazó la devolución (${json.errorCode})` };
    }
    const params = this.verify(json.Ds_MerchantParameters, json.Ds_Signature);
    if (!params) throw new Error("Respuesta de Redsys con firma inválida");
    // 0900 = devolución aceptada.
    const ok = params.Ds_Response === "0900";
    return { providerRef: `${providerRef}:${params.Ds_AuthorisationCode ?? "dev"}`, status: ok ? "succeeded" : "failed" };
  }

  /**
   * Notificación de Redsys (application/x-www-form-urlencoded) o los mismos parámetros
   * en la URL de vuelta a la tienda. Ds_Response 0000-0099 = pago autorizado.
   */
  verifyAndParse(rawBody: string): PaymentWebhookEvent | null {
    const form = new URLSearchParams(rawBody);
    const paramsB64 = form.get("Ds_MerchantParameters");
    const signature = form.get("Ds_Signature");
    if (!paramsB64 || !signature) return null;
    const p = this.verify(paramsB64, signature);
    if (!p) return null;
    const code = Number(p.Ds_Response);
    const ok = Number.isInteger(code) && code >= 0 && code <= 99;
    return {
      // Mismo id para la notificación y la vuelta del comprador: se procesa una vez.
      id: `redsys:${p.Ds_Order}:${p.Ds_Response}`,
      type: ok ? "payment_succeeded" : "payment_failed",
      providerRef: p.Ds_Order,
      amountCents: Number(p.Ds_Amount),
    };
  }
}
