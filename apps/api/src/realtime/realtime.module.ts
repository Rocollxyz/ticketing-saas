import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * Capa de tiempo real (Fase 3). El gateway escucha eventos de dominio (vía
 * EventEmitter, registrado global en AppModule) y los retransmite por WebSocket.
 */
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
