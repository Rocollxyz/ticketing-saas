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
}

export interface ShopTicketType {
  id: string;
  name: string;
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

export interface EventDetail {
  attendeeFields: AttendeeFieldPublic[];
  organizer: { name: string; slug: string; logoUrl: string | null; accentColor: string | null } | null;
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
  p?.accentColor && /^#[0-9a-f]{6}$/i.test(p.accentColor) ? p.accentColor : "#5b9dff";

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
