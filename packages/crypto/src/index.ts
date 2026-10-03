import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Firma y verificación de QR de entrada (§5/§6 ARCHITECTURE.md).
 *
 * Token = base64url(payload).base64url(HMAC-SHA256(payload, key)).
 * La clave es POR EVENTO (event_signing_key), de modo que la app de acceso puede
 * validar offline conociendo solo la clave de su evento. Verificación con
 * comparación en tiempo constante (anti timing).
 *
 * Nota: este es el QR ESTÁTICO de un solo uso. El QR dinámico/rotativo (TOTP) es
 * trabajo pospuesto (§10) y se construirá sobre estas mismas primitivas.
 */

export interface TicketQrPayload {
  /** ticket id */
  t: string;
  /** event id */
  e: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Genera una clave de firma aleatoria (256 bits) para un evento. */
export function generateSigningKey(): string {
  return randomBytes(32).toString("base64");
}

export function signTicketQr(payload: TicketQrPayload, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(createHmac("sha256", key).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyTicketQr(
  token: string,
  keyBase64: string,
): TicketQrPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const key = Buffer.from(keyBase64, "base64");
  const expected = b64url(createHmac("sha256", key).update(body).digest());

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as TicketQrPayload;
  } catch {
    return null;
  }
}
