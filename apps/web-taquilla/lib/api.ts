export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export interface PosEvent {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  seatingMode: "RESERVED" | "GENERAL";
}

export interface PosTicketType {
  id: string;
  name: string;
  /** Con asiento (plano) o sin asiento (por cantidad). */
  seating?: "RESERVED" | "GENERAL";
  precioCents: number | null;
  disponibles: number;
}

export interface PosAttendeeField {
  id: string;
  presetKey: string | null;
  label: string;
  type: "text" | "textarea" | "email" | "phone" | "number" | "select" | "checkbox" | "date" | "dni";
  required: boolean;
  options: string[] | null;
  ticketTypeIds: string[] | null;
}

export interface BillingData {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
}

export interface PosSeatmap {
  event: { id: string; name: string; seatingMode: "RESERVED" | "GENERAL" };
  attendeeFields: PosAttendeeField[];
  ticketTypes: PosTicketType[];
  /** Solo en eventos numerados. */
  seats: PosSeat[];
}

export interface PosSeat {
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

export interface SaleResult {
  orderId: string;
  method: "cash" | "card";
  amountCents: string;
  currency: string;
  providerRef: string;
  tickets: { ticketId: string; seat: string; attendeeName: string | null; qr: string }[];
}

async function authed<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.message ?? `Error ${r.status}`);
  }
  return r.json();
}

export async function login(email: string, password: string, tenantSlug: string) {
  const r = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  if (!r.ok) throw new Error("Credenciales inválidas");
  return r.json() as Promise<{ token: string; role: string }>;
}

export const listEvents = (token: string) => authed<PosEvent[]>(token, "/pos/events");

export const getSeats = (token: string, eventId: string) =>
  authed<PosSeatmap>(token, `/pos/events/${eventId}/seats`);

/** Numerado → `seatIds`; entrada general → `quantities` {ticketTypeId: n}. */
export const sell = (
  token: string,
  eventId: string,
  selection: { seatIds?: string[]; quantities?: Record<string, number> },
  method: "cash" | "card",
  buyerEmail?: string,
  extra: {
    /** Datos de cada entrada: por asiento (numerado) o por categoría en orden (general). */
    attendees?: { seatId?: string; ticketTypeId: string | null; values: Record<string, string | boolean> }[];
    /** Factura completa a nombre de empresa o autónomo. */
    billing?: BillingData;
  } = {},
) =>
  authed<SaleResult>(token, "/pos/sell", {
    method: "POST",
    body: JSON.stringify({ eventId, ...selection, method, buyerEmail: buyerEmail || undefined, ...extra }),
  });

export function euros(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
