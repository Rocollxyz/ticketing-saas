/**
 * Reglas de venta ONLINE (tienda). La taquilla las ignora salvo el estado del evento:
 * en puerta se vende aunque la venta online haya cerrado.
 */

export type SalesState =
  | { open: true }
  | { open: false; reason: "NOT_ON_SALE" | "CANCELLED" | "NOT_STARTED" | "ENDED"; from?: Date };

interface EventLike {
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
}

/** Fin de venta online por defecto: el explícito, o el fin del evento, o su inicio. */
export const salesEndOf = (ev: EventLike) => ev.salesEndAt ?? ev.endsAt ?? ev.startsAt;

export function eventSalesState(ev: EventLike, now = new Date()): SalesState {
  if (ev.status === "CANCELLED") return { open: false, reason: "CANCELLED" };
  if (ev.status !== "ON_SALE") return { open: false, reason: "NOT_ON_SALE" };
  if (ev.salesStartAt && now < ev.salesStartAt) {
    return { open: false, reason: "NOT_STARTED", from: ev.salesStartAt };
  }
  const end = salesEndOf(ev);
  if (end && now >= end) return { open: false, reason: "ENDED" };
  return { open: true };
}

export function ticketTypeSalesState(
  tt: { salesStartAt: Date | null; salesEndAt: Date | null },
  now = new Date(),
): SalesState {
  if (tt.salesStartAt && now < tt.salesStartAt) {
    return { open: false, reason: "NOT_STARTED", from: tt.salesStartAt };
  }
  if (tt.salesEndAt && now >= tt.salesEndAt) return { open: false, reason: "ENDED" };
  return { open: true };
}

export const SALES_REASON_TEXT: Record<string, string> = {
  NOT_ON_SALE: "Este evento no está a la venta",
  CANCELLED: "Este evento ha sido cancelado",
  NOT_STARTED: "La venta aún no ha empezado",
  ENDED: "La venta ha finalizado",
};
