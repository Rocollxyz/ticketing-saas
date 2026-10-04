import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado en reposo de secretos guardados en la BD (p. ej. la clave que firma los QR,
 * SECURITY_AUDIT E1): AES-256-GCM con una clave maestra que NO está en la BD
 * (MASTER_KEY, 32 bytes en base64; en producción, del gestor de secretos).
 *
 * Formato: `v1:<iv>:<tag>:<cifrado>` (base64). Un valor sin prefijo es un secreto antiguo
 * en claro: se lee tal cual y KeyEncryptionMigration lo cifra al arrancar.
 */
const PREFIX = "v1:";

function masterKey(): Buffer {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error("Falta MASTER_KEY (32 bytes en base64): genera una con `openssl rand -base64 32`");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEY debe tener 32 bytes (base64)");
  return key;
}

export const isSealed = (v: string) => v.startsWith(PREFIX);

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function open(stored: string): string {
  if (!isSealed(stored)) return stored; // antiguo, en claro (se migra al arrancar)
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
