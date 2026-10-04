export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export type EventStatus = "DRAFT" | "ON_SALE" | "CLOSED" | "CANCELLED";
export type SeatingMode = "RESERVED" | "GENERAL";

export interface PromoterEvent {
  id: string;
  name: string;
  status: EventStatus;
  startsAt: string | null;
  timezone: string;
  imageUrl: string | null;
  visibility: "PUBLIC" | "UNLISTED";
  seatingMode: SeatingMode;
  venueName: string | null;
  sold: number;
  capacity: number;
  revenueCents: number;
}

export interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  mapsUrl: string | null;
}

export interface EventData {
  id: string;
  name: string;
  status: EventStatus;
  summary: string | null;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  doorsAt: string | null;
  visibility: "PUBLIC" | "UNLISTED";
  seatingMode: SeatingMode;
  salesStartAt: string | null;
  salesEndAt: string | null;
  maxPerOrder: number;
  minAge: number | null;
  refundPolicy: string | null;
  contactEmail: string | null;
  confirmationMessage: string | null;
  venueId: string | null;
  publishedAt: string | null;
}

export interface TicketTypeData {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  earlyBird: { priceCents: number; until: string } | null;
  currentCents: number | null;
  capacity: number;
  sold: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  minPerOrder: number;
  maxPerOrder: number | null;
  sortOrder: number;
}

export interface EventDetail {
  event: EventData;
  venue: Venue | null;
  ticketTypes: TicketTypeData[];
  stats: { sold: number; revenueCents: number; capacity: number };
  checklist: string[];
}

export type StatusAction = "publish" | "unpublish" | "close" | "reopen" | "cancel";

/** Campos editables del tipo de entrada (lo que envía el formulario). */
export interface TicketTypeInput {
  name?: string;
  description?: string | null;
  priceCents?: number;
  earlyBird?: { priceCents: number; until: string } | null;
  capacity?: number | null;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
  minPerOrder?: number;
  maxPerOrder?: number | null;
  sortOrder?: number;
}

export interface TicketTypeOption {
  id: string;
  name: string;
  precioCents: number | null;
}

export interface EditorSeat {
  id: string;
  fila: string;
  numero: number;
  posX: number | null;
  posY: number | null;
  zoneId: string;
  ticketTypeId: string | null;
  /** Creado en el editor y aún sin guardar (su id es temporal). */
  isNew?: boolean;
}

export interface Seatmap {
  event: { id: string; name: string; status: string };
  ticketTypes: TicketTypeOption[];
  seats: EditorSeat[];
}

export interface SeatPatch {
  seatId: string;
  posX: number | null;
  posY: number | null;
  ticketTypeId: string | null;
}

/** Error de la API con el mensaje para el usuario y, al publicar, la lista de problemas. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

async function authed<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const msg = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new ApiError(r.status, msg ?? `Error ${r.status}`, body?.problems ?? []);
  }
  return r.json();
}

export async function login(
  email: string,
  password: string,
  tenantSlug: string,
): Promise<{ token: string; tenant: string; role: string }> {
  const r = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  if (!r.ok) throw new Error("Credenciales inválidas");
  return r.json();
}

export const listEvents = (token: string) => authed<PromoterEvent[]>(token, "/events");

export const getEvent = (token: string, id: string) => authed<EventDetail>(token, `/events/${id}`);

export const createEvent = (token: string, data: Partial<EventData>) =>
  authed<EventData>(token, "/events", { method: "POST", body: JSON.stringify(data) });

export const updateEvent = (token: string, id: string, data: Partial<EventData>) =>
  authed<EventDetail>(token, `/events/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const setEventStatus = (token: string, id: string, action: StatusAction) =>
  authed<EventDetail>(token, `/events/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });

export const duplicateEvent = (token: string, id: string) =>
  authed<EventData>(token, `/events/${id}/duplicate`, { method: "POST" });

export const createTicketType = (token: string, eventId: string, data: TicketTypeInput) =>
  authed<{ id: string }>(token, `/events/${eventId}/ticket-types`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateTicketType = (token: string, eventId: string, id: string, data: TicketTypeInput) =>
  authed<{ ok: true }>(token, `/events/${eventId}/ticket-types/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteTicketType = (token: string, eventId: string, id: string) =>
  authed<{ ok: true }>(token, `/events/${eventId}/ticket-types/${id}`, { method: "DELETE" });

export const listVenues = (token: string) => authed<Venue[]>(token, "/venues");

export const createVenue = (token: string, data: Partial<Venue>) =>
  authed<Venue>(token, "/venues", { method: "POST", body: JSON.stringify(data) });

export const updateVenue = (token: string, id: string, data: Partial<Venue>) =>
  authed<Venue>(token, `/venues/${id}`, { method: "PATCH", body: JSON.stringify(data) });

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

export const getProfile = (token: string) => authed<Profile>(token, "/profile");

export const updateProfile = (token: string, data: Partial<Profile>) =>
  authed<Profile>(token, "/profile", { method: "PATCH", body: JSON.stringify(data) });

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

export interface AttendeeField {
  id: string;
  presetKey: string | null;
  label: string;
  type: AttendeeFieldType;
  required: boolean;
  helpText: string | null;
  options: string[] | null;
  ticketTypeIds: string[] | null;
  showOnTicket: boolean;
  sortOrder: number;
}

export type AttendeeFieldInput = Partial<Omit<AttendeeField, "id" | "sortOrder">>;

export const listAttendeeFields = (token: string, eventId: string) =>
  authed<AttendeeField[]>(token, `/events/${eventId}/attendee-fields`);

export const createAttendeeField = (token: string, eventId: string, data: AttendeeFieldInput) =>
  authed<AttendeeField>(token, `/events/${eventId}/attendee-fields`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAttendeeField = (token: string, eventId: string, id: string, data: AttendeeFieldInput) =>
  authed<AttendeeField>(token, `/events/${eventId}/attendee-fields/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteAttendeeField = (token: string, eventId: string, id: string) =>
  authed<{ ok: true }>(token, `/events/${eventId}/attendee-fields/${id}`, { method: "DELETE" });

export const reorderAttendeeFields = (token: string, eventId: string, ids: string[]) =>
  authed<AttendeeField[]>(token, `/events/${eventId}/attendee-fields/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });

export type TicketStatus = "ISSUED" | "CHECKED_IN" | "VOID";
export type TicketChannel = "online" | "taquilla" | "invitacion";

export interface AttendeeAnswer {
  fieldId: string;
  label: string;
  value: string;
  onTicket?: boolean;
  preset?: string;
}

export interface IssuedTicketRow {
  id: string;
  status: TicketStatus;
  orderId: string;
  attendeeName: string | null;
  attendee: AttendeeAnswer[];
  createdAt: string;
  buyerEmail: string | null;
  buyerName: string | null;
  ticketTypeId: string | null;
  categoria: string | null;
  seat: string;
  isGeneral: boolean;
  channel: TicketChannel;
  checkedInAt: string | null;
  couponCode: string | null;
}

export interface TicketFilters {
  q?: string;
  status?: TicketStatus | "";
  ticketTypeId?: string;
}

export interface TicketPage {
  total: number;
  offset: number;
  pageSize: number;
  counts: { issued: number; checkedIn: number; void: number };
  tickets: IssuedTicketRow[];
}

const ticketQuery = (f: TicketFilters, offset?: number) => {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.ticketTypeId) p.set("ticketTypeId", f.ticketTypeId);
  if (offset) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listTickets = (token: string, eventId: string, f: TicketFilters, offset = 0) =>
  authed<TicketPage>(token, `/events/${eventId}/tickets${ticketQuery(f, offset)}`);

export const updateTicketAttendee = (token: string, eventId: string, ticketId: string, values: Record<string, unknown>) =>
  authed<{ ok: true; attendee: AttendeeAnswer[]; attendeeName: string | null }>(
    token,
    `/events/${eventId}/tickets/${ticketId}/attendee`,
    { method: "PATCH", body: JSON.stringify({ values }) },
  );

export const resendTicket = (token: string, eventId: string, ticketId: string, data: { to?: string; wholeOrder?: boolean }) =>
  authed<{ ok: true; to: string; count: number }>(token, `/events/${eventId}/tickets/${ticketId}/resend`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const voidTicket = (token: string, eventId: string, ticketId: string, data: { release: boolean; reason?: string }) =>
  authed<{ ok: true; released: boolean }>(token, `/events/${eventId}/tickets/${ticketId}/void`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const issueManualTickets = (
  token: string,
  eventId: string,
  data: { quantities: Record<string, number>; buyerName?: string; buyerEmail?: string; sendEmail: boolean },
) =>
  authed<{ orderId: string; ticketIds: string[]; emailed: boolean }>(token, `/events/${eventId}/tickets`, {
    method: "POST",
    body: JSON.stringify(data),
  });

/** Descarga el CSV de asistentes (con los filtros actuales) como fichero. */
export async function downloadTicketsCsv(token: string, eventId: string, f: TicketFilters) {
  const r = await fetch(`${API_URL}/events/${eventId}/tickets/export.csv${ticketQuery(f)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new ApiError(r.status, body?.message ?? `Error ${r.status}`);
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "asistentes.csv";
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export type CouponKind = "PERCENT" | "AMOUNT";

export interface Coupon {
  id: string;
  eventId: string | null;
  code: string;
  kind: CouponKind;
  /** % (1-100) o céntimos por entrada. */
  value: number;
  ticketTypeIds: string[] | null;
  maxUses: number | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  uses: number;
  discountedCents: number;
}

export type CouponInput = Partial<Omit<Coupon, "id" | "uses" | "discountedCents">>;

export const listCoupons = (token: string, eventId: string) =>
  authed<Coupon[]>(token, `/coupons?eventId=${eventId}`);

export const createCoupon = (token: string, data: CouponInput) =>
  authed<Coupon>(token, "/coupons", { method: "POST", body: JSON.stringify(data) });

export const updateCoupon = (token: string, id: string, data: CouponInput) =>
  authed<Coupon>(token, `/coupons/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteCoupon = (token: string, id: string) =>
  authed<{ ok: true }>(token, `/coupons/${id}`, { method: "DELETE" });

export type ImageKind = "event" | "cover" | "logo";

/** Sube una imagen (multipart). La API la valida, la recodifica a WebP y devuelve su URL. */
export async function uploadImage(token: string, file: File, kind: ImageKind): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API_URL}/uploads/images?kind=${kind}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }, // sin content-type: lo pone el navegador
    body: form,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const msg =
      r.status === 413 ? "La imagen supera los 10 MB" : (body?.message ?? `Error ${r.status} al subir la imagen`);
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

/** URL pública del evento en la web de compra. */
export const SHOP_URL = process.env.NEXT_PUBLIC_SHOP_URL ?? "http://localhost:3001";

export const getSeatmap = (token: string, eventId: string) =>
  authed<Seatmap>(token, `/events/${eventId}/seatmap`);

export interface NewSeat {
  fila: string;
  numero: number;
  posX: number | null;
  posY: number | null;
  ticketTypeId: string | null;
}

export interface SeatmapChanges {
  seats: SeatPatch[];
  created: NewSeat[];
  deleted: string[];
}

export const saveSeatmap = (token: string, eventId: string, changes: SeatmapChanges) =>
  authed<{ updated: number; created: number; deleted: number }>(
    token,
    `/events/${eventId}/seatmap`,
    { method: "PUT", body: JSON.stringify(changes) },
  );

export function euros(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
