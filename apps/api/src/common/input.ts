import { BadRequestException } from "@nestjs/common";

/**
 * Validación de entrada de la gestión (eventos, perfil…) (sin class-validator: el proyecto aún
 * no tiene ValidationPipe — SECURITY_AUDIT C2). Cada lector acepta `undefined` (campo
 * no enviado → no se toca) y devuelve el valor normalizado o lanza 400 con un mensaje
 * para el promotor.
 */

type Opt<T> = T | undefined;

const bad = (msg: string): never => {
  throw new BadRequestException(msg);
};

export function text(v: unknown, label: string, max: number, required = false): Opt<string | null> {
  if (v === undefined) return required ? bad(`${label}: obligatorio`) : undefined;
  if (v === null || v === "") return required ? bad(`${label}: obligatorio`) : null;
  if (typeof v !== "string") return bad(`${label}: texto inválido`);
  const s = v.trim();
  if (!s) return required ? bad(`${label}: obligatorio`) : null;
  if (s.length > max) return bad(`${label}: máximo ${max} caracteres`);
  return s;
}

export function int(v: unknown, label: string, min: number, max: number, nullable = true): Opt<number | null> {
  if (v === undefined) return undefined;
  if (v === null || v === "") return nullable ? null : bad(`${label}: obligatorio`);
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    return bad(`${label}: debe ser un entero entre ${min} y ${max}`);
  }
  return n;
}

export function date(v: unknown, label: string): Opt<Date | null> {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return bad(`${label}: fecha inválida`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? bad(`${label}: fecha inválida`) : d;
}

export function oneOf<T extends string>(v: unknown, label: string, values: readonly T[]): Opt<T> {
  if (v === undefined) return undefined;
  return values.includes(v as T) ? (v as T) : bad(`${label}: valor inválido`);
}

export function email(v: unknown, label: string): Opt<string | null> {
  const s = text(v, label, 254);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return bad(`${label}: email inválido`);
  return s?.toLowerCase() ?? s;
}

/**
 * URL http/https. Devuelve la forma NORMALIZADA (`URL.href`): codifica comillas y
 * espacios, así es segura dentro de `url("…")` en CSS o de un atributo href.
 */
export function url(v: unknown, label: string): Opt<string | null> {
  const s = text(v, label, 2000);
  if (!s) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.href;
  } catch {
    return bad(`${label}: URL inválida (http/https)`);
  }
}

export function timezone(v: unknown): Opt<string> {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return bad("Zona horaria inválida");
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: v });
    return v;
  } catch {
    return bad("Zona horaria inválida");
  }
}

export function uuid(v: unknown, label: string): Opt<string | null> {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) return bad(`${label}: id inválido`);
  return v;
}

/** Elimina las claves `undefined` (no enviadas) para que un PATCH no las pise. */
export function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Comprueba el orden de dos fechas (si ambas existen). */
export function assertOrder(a: Date | null | undefined, b: Date | null | undefined, msg: string) {
  if (a && b && a.getTime() > b.getTime()) bad(msg);
}

/** #rrggbb (color de marca). */
export function hexColor(v: unknown, label: string): Opt<string | null> {
  const s = text(v, label, 7);
  if (s && !/^#[0-9a-f]{6}$/i.test(s)) return bad(`${label}: usa el formato #rrggbb`);
  return s?.toLowerCase() ?? s;
}

const SOCIAL_BASE: Record<string, string> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  tiktok: "https://tiktok.com/@",
  x: "https://x.com/",
  youtube: "https://youtube.com/@",
};

/** Red social: acepta "@usuario", "usuario" o la URL completa → siempre URL https. */
export function social(v: unknown, network: keyof typeof SOCIAL_BASE, label: string): Opt<string | null> {
  const s = text(v, label, 300);
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return url(s, label);
  const handle = s.replace(/^@/, "");
  if (!/^[\w.\-]{1,100}$/.test(handle)) return bad(`${label}: usuario inválido`);
  return SOCIAL_BASE[network] + handle;
}
