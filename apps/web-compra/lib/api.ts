import { notFound } from "next/navigation";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export interface ShopEvent {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  imageUrl: string | null;
  timezone: string;
  startsAt: string | null;
  venueName: string | null;
  venueCity: string | null;
  fromCents: number | null;
  allFree: boolean;
  soldOut: boolean;
  salesOpen: boolean;
  salesMessage: string | null;
}

export interface ShopSeat {
  id: string;
  fila: string;
  numero: number;
  posX: number | null;
  posY: number | null;
  ticketTypeId: string | null;
  categoria: string | null;
  precioCents: number | null;
  disponible: boolean;
  /** Vendido (no solo reservado por otro): para pintarlo como «vendido» desde el inicio. */
  vendido?: boolean;
}

export interface ShopTicketType {
  id: string;
  name: string;
  /** Numerada (se elige en el plano) o general (por cantidad). */
  seating?: "RESERVED" | "GENERAL";
  description: string | null;
  precioCents: number | null;
  /** Precio normal cuando ahora rige el anticipado (si no, null). */
  regularCents: number | null;
  /** Hasta cuándo dura el precio actual (anticipada). */
  priceEndsAt: string | null;
  minPerOrder: number;
  maxPerOrder: number | null;
  disponibles: number;
  salesOpen: boolean;
  salesMessage: string | null;
}

export type AttendeeFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "select"
  | "checkbox"
  | "date"
  | "dni";

export interface AttendeeFieldPublic {
  id: string;
  presetKey: string | null;
  label: string;
  type: AttendeeFieldType;
  required: boolean;
  helpText: string | null;
  options: string[] | null;
  ticketTypeIds: string[] | null;
}

/** Plaza reservada: a qué categoría pertenece y su etiqueta ("A3" o "General"). */
export interface HeldSeat {
  seatId: string;
  ticketTypeId: string | null;
  label: string;
}

/** Campos del formulario que aplican a una categoría. */
export const fieldsFor = (fields: AttendeeFieldPublic[], ticketTypeId: string | null) =>
  fields.filter((f) => !f.ticketTypeIds?.length || (ticketTypeId != null && f.ticketTypeIds.includes(ticketTypeId)));

export type PaymentMethod = "card" | "bizum";

export interface EventDetail {
  attendeeFields: AttendeeFieldPublic[];
  /** Información de protección de datos (art. 13 RGPD) que se muestra al comprar. */
  privacy?: {
    controller: string;
    contactEmail: string | null;
    privacyUrl: string | null;
    termsUrl: string | null;
    retentionDays: number;
  };
  /** Minutos que se guardan las entradas al reservar. */
  holdMinutes?: number;
  /** Cómo se puede pagar (según las pasarelas activas). */
  paymentMethods?: PaymentMethod[];
  /** Hay códigos de descuento activos: se muestra la casilla para escribirlo. */
  couponsAvailable?: boolean;
  organizer: {
    name: string;
    slug: string;
    logoUrl: string | null;
    accentColor: string | null;
    /** Tema elegido por el promotor. */
    theme?: ShopTheme | null;
  } | null;
  event: {
    id: string;
    name: string;
    status: string;
    summary: string | null;
    description: string | null;
    category: string | null;
    imageUrl: string | null;
    timezone: string;
    startsAt: string | null;
    endsAt: string | null;
    doorsAt: string | null;
    seatingMode: "RESERVED" | "GENERAL";
    maxPerOrder: number;
    minAge: number | null;
    refundPolicy: string | null;
    contactEmail: string | null;
  };
  venue: {
    name: string;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    mapsUrl: string | null;
  } | null;
  sales: { open: boolean; message: string | null; from?: string | null };
  ticketTypes: ShopTicketType[];
  seats: ShopSeat[];
}

export interface Profile {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  accentColor: string | null;
  city: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  x: string | null;
  youtube: string | null;
  /** Tema elegido por el promotor. */
  theme?: ShopTheme | null;
}

export interface PastEvent {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  timezone: string;
  startsAt: string | null;
  venueName: string | null;
  venueCity: string | null;
}

export async function fetchProfile(slug: string): Promise<Profile> {
  const r = await fetch(`${API_URL}/shop/${slug}/profile`, { cache: "no-store" });
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error("No se pudo cargar el promotor");
  return r.json();
}

export async function fetchPastEvents(slug: string): Promise<PastEvent[]> {
  const r = await fetch(`${API_URL}/shop/${slug}/events/past`, { cache: "no-store" });
  return r.ok ? r.json() : [];
}

/** Color de marca del promotor (o el azul por defecto). */
export const accentOf = (p: { accentColor: string | null } | null | undefined) =>
  p?.accentColor && /^#[0-9a-f]{6}$/i.test(p.accentColor) ? p.accentColor : "#2563eb";

export type ShopTheme = "light" | "dark";

/** Tema de la tienda de un promotor (lo elige en su perfil de la consola; claro por defecto). */
export const themeOf = (p: { theme?: ShopTheme | null } | null | undefined): ShopTheme =>
  p?.theme === "dark" ? "dark" : "light";

/** Texto legible sobre un color de fondo (#rrggbb): negro si es claro, blanco si es oscuro. */
export function inkFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? "#0f1115" : "#ffffff";
}

export async function fetchEvents(slug: string): Promise<ShopEvent[]> {
  const r = await fetch(`${API_URL}/shop/${slug}/events`, { cache: "no-store" });
  // Slug inexistente (o rutas sueltas como /favicon.ico) → 404, no un error 500.
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error("No se pudo cargar el catálogo");
  return r.json();
}

export async function fetchEvent(slug: string, eventId: string): Promise<EventDetail> {
  const r = await fetch(`${API_URL}/shop/${slug}/events/${eventId}`, { cache: "no-store" });
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error("Evento no disponible");
  return r.json();
}

export async function fetchConfirmation(
  slug: string,
  eventId: string,
): Promise<{ name: string; message: string | null } | null> {
  const r = await fetch(`${API_URL}/shop/${slug}/events/${eventId}/confirmation`, { cache: "no-store" });
  return r.ok ? r.json() : null;
}

/**
 * Vuelta desde Redsys: envía el resultado firmado que trae la URL para que la API lo
 * verifique y confirme el pago (si la notificación aún no llegó). Devuelve el estado.
 */
export async function confirmReturn(
  slug: string,
  orderId: string,
  signed: Record<string, string>,
): Promise<{ status: "PENDING" | "PAID" | "CANCELLED"; eventId: string; tickets: number } | null> {
  const r = await fetch(`${API_URL}/shop/${slug}/orders/${orderId}/confirm-return`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed),
    cache: "no-store",
  });
  return r.ok ? r.json() : null;
}

/** Fecha en la zona del evento: "sábado, 12 de diciembre de 2026, 21:00". */
export function formatDate(iso: string | null, tz: string, opts: { long?: boolean; timeOnly?: boolean } = {}) {
  if (!iso) return "Fecha por anunciar";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    ...(opts.timeOnly
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          weekday: opts.long ? "long" : "short",
          day: "numeric",
          month: opts.long ? "long" : "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
  }).format(new Date(iso));
}

export function euros(cents: number | null): string {
  if (cents == null) return "—";
  if (cents === 0) return "Gratis";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
