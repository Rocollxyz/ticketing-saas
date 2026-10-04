import { Module } from "@nestjs/common";
import { ReservationModule } from "../reservation/reservation.module";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";

/** Gestión de entradas emitidas (consola del promotor). Reutiliza el motor de reserva. */
@Module({
  imports: [ReservationModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
