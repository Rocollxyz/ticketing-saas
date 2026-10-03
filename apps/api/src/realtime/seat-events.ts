/**
 * Eventos de dominio del tiempo real de asientos. La lógica de negocio (reserva,
 * checkout, sweeper) los EMITE vía EventEmitter2 tras hacer COMMIT; el
 * RealtimeGateway los escucha (@OnEvent) y los retransmite por WebSocket a la sala
 * del evento. Así el dominio no depende del transporte (gateway), solo del bus.
 */

export const SEATS_HELD = "seats.held";
export const SEATS_RELEASED = "seats.released";
export const SEATS_SOLD = "seats.sold";

/** Asientos que pasan a OCUPADOS por un hold recién creado. */
export interface SeatsHeldEvent {
  eventId: string;
  seatIds: string[];
  /** sessionId de quien reservó: el propio comprador lo ignora (no se auto-bloquea). */
  actor: string;
}

/** Asientos que vuelven a estar LIBRES (hold expirado o liberado). */
export interface SeatsReleasedEvent {
  eventId: string;
  seatIds: string[];
}

/** Asientos VENDIDOS de forma definitiva (pedido pagado, ticket emitido). */
export interface SeatsSoldEvent {
  eventId: string;
  seatIds: string[];
}

/** Nombre de la sala socket.io por evento. eventId es UUID global → sin colisión entre tenants. */
export const roomForEvent = (eventId: string) => `event:${eventId}`;
