import { Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import {
  roomForEvent,
  SEATS_HELD,
  SEATS_RELEASED,
  SEATS_SOLD,
  type SeatsHeldEvent,
  type SeatsReleasedEvent,
  type SeatsSoldEvent,
} from "./seat-events";

// CORS del canal WebSocket: igual criterio que el HTTP (main.ts). En dev refleja
// cualquier origen; en prod se restringe a WEB_ORIGIN (dominios reales de tiendas).
const corsOrigin = process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",") : true;

/**
 * Puente de tiempo real comprador↔comprador. Los navegadores se unen a la sala de
 * su evento (`join`); cuando un comprador reserva/compra o un hold expira, el
 * dominio emite un evento que aquí se retransmite a todos los de esa sala para que
 * vean la disponibilidad cambiar en vivo. No mantiene estado: la verdad sigue en BD
 * (holds/tickets); esto es solo notificación.
 */
@WebSocketGateway({ cors: { origin: corsOrigin }, transports: ["websocket", "polling"] })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket) {
    this.logger.debug(`cliente conectado: ${client.id}`);
  }

  /** El comprador se suscribe a la disponibilidad en vivo de un evento. */
  @SubscribeMessage("join")
  onJoin(client: Socket, payload: { eventId?: string }) {
    const eventId = payload?.eventId;
    if (!eventId) return { ok: false };
    void client.join(roomForEvent(eventId));
    return { ok: true, room: roomForEvent(eventId) };
  }

  @OnEvent(SEATS_HELD)
  broadcastHeld(e: SeatsHeldEvent) {
    this.server
      .to(roomForEvent(e.eventId))
      .emit(SEATS_HELD, { seatIds: e.seatIds, actor: e.actor });
  }

  @OnEvent(SEATS_RELEASED)
  broadcastReleased(e: SeatsReleasedEvent) {
    this.server.to(roomForEvent(e.eventId)).emit(SEATS_RELEASED, { seatIds: e.seatIds });
  }

  @OnEvent(SEATS_SOLD)
  broadcastSold(e: SeatsSoldEvent) {
    this.server.to(roomForEvent(e.eventId)).emit(SEATS_SOLD, { seatIds: e.seatIds });
  }
}
