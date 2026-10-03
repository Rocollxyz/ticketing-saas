import { io, type Socket } from "socket.io-client";
import { API_URL } from "./api";

/** Eventos de tiempo real emitidos por la API (deben coincidir con realtime/seat-events.ts). */
export const SEATS_HELD = "seats.held";
export const SEATS_RELEASED = "seats.released";
export const SEATS_SOLD = "seats.sold";

export interface HeldPayload {
  seatIds: string[];
  actor: string;
}
export interface SeatIdsPayload {
  seatIds: string[];
}

/** Abre la conexión y se une a la sala del evento. */
export function connectToEvent(eventId: string): Socket {
  const socket = io(API_URL, { transports: ["websocket", "polling"] });
  socket.on("connect", () => socket.emit("join", { eventId }));
  return socket;
}
