import { createHash } from "node:crypto";
import { isValidDni } from "../catalog/attendee";

/**
 * Reglas fiscales puras (sin BD): reparto base/cuota de precios con impuesto incluido,
 * validación de NIF y huella del registro de facturación (VERI*FACTU).
 */

/** Límite de la factura simplificada para entradas (RD 1619/2012, art. 4.1.a). */
export const SIMPLIFIED_LIMIT_CENTS = 40_000;

/** Precio con impuesto incluido → base y cuota (la cuota absorbe el redondeo). */
export function splitGross(grossCents: number, rateBp: number): { baseCents: number; taxCents: number } {
  const baseCents = Math.round((grossCents * 10_000) / (10_000 + rateBp));
  return { baseCents, taxCents: grossCents - baseCents };
}

/** «10 %», «21 %», «9,5 %». */
export const formatRate = (bp: number) => `${(bp / 100).toLocaleString("es-ES")} %`;

/** Importe para la huella y el QR: punto decimal y dos decimales («123.40», «-5.00»). */
export const aeatAmount = (cents: number) => (cents / 100).toFixed(2);

/** Fecha para la huella y el QR: DD-MM-AAAA (en hora de España). */
export function aeatDate(d: Date): string {
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/** Instante con huso horario de Madrid (ISO 8601): 2026-10-04T08:20:30+02:00. */
export function aeatTimestamp(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  const offset = get("timeZoneName").replace("GMT", "") || "+00:00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

/**
 * Huella SHA-256 de un registro de alta (especificación de la AEAT para VERI*FACTU):
 * 8 campos `nombre=valor` unidos por `&`, en este orden, sin codificar; resultado en
 * hexadecimal MAYÚSCULAS. `prevHash` vacío en el primer registro del emisor.
 */
export function recordHash(r: {
  issuerTaxId: string;
  fullNumber: string;
  issueDate: string; // DD-MM-AAAA
  aeatType: string;
  taxCents: number;
  totalCents: number;
  prevHash: string | null;
  recordedAt: string; // aeatTimestamp
}): string {
  const s =
    `IDEmisorFactura=${r.issuerTaxId.trim()}` +
    `&NumSerieFactura=${r.fullNumber.trim()}` +
    `&FechaExpedicionFactura=${r.issueDate}` +
    `&TipoFactura=${r.aeatType}` +
    `&CuotaTotal=${aeatAmount(r.taxCents)}` +
    `&ImporteTotal=${aeatAmount(r.totalCents)}` +
    `&Huella=${r.prevHash ?? ""}` +
    `&FechaHoraHusoGenRegistro=${r.recordedAt}`;
  return createHash("sha256").update(s, "utf8").digest("hex").toUpperCase();
}

/** NIF normalizado (sin espacios ni guiones, en mayúsculas). */
export const normalizeTaxId = (v: string) => v.toUpperCase().replace(/[\s.-]/g, "");

const CIF_LETTERS = "JABCDEFGHI";

/** CIF de persona jurídica (letra + 7 cifras + control numérico o letra). */
function isValidCif(v: string): boolean {
  const m = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v);
  if (!m) return false;
  const [, letter, digits, control] = m;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(digits[i]);
    if (i % 2 === 0) {
      const d = n * 2;
      sum += Math.floor(d / 10) + (d % 10);
    } else sum += n;
  }
  const c = (10 - (sum % 10)) % 10;
  // Según la letra inicial el control es cifra, letra o cualquiera de los dos.
  if ("PQRSNW".includes(letter)) return control === CIF_LETTERS[c];
  if ("ABEH".includes(letter)) return control === String(c);
  return control === String(c) || control === CIF_LETTERS[c];
}

/** NIF español válido: DNI, NIE o CIF. */
export const isValidSpanishTaxId = (v: string) => {
  const n = normalizeTaxId(v);
  return isValidDni(n) || isValidCif(n);
};
