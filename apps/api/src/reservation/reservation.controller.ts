import { Body, Controller, Param, Post } from "@nestjs/common";
import { getStore } from "../database/tenant-context";
import { ReservationService } from "./reservation.service";

@Controller()
export class ReservationController {
  constructor(private readonly reservation: ReservationService) {}

  /** Reserva temporal de asientos (hold de 10 min). */
  @Post("holds")
  createHold(
    @Body() body: { eventId: string; seatIds: string[]; sessionId?: string },
  ) {
    const sessionId = body.sessionId ?? getStore()!.userId;
    return this.reservation.createHold(body.eventId, body.seatIds, sessionId);
  }

  /** Confirma el pago (simulado) y emite las entradas con QR firmado. */
  @Post("holds/:id/confirm")
  confirm(@Param("id") id: string, @Body() body: { buyerEmail?: string }) {
    return this.reservation.confirmAndIssue(id, body.buyerEmail);
  }

  /** Disparo manual del barrido de holds expirados (también corre por sweeper). */
  @Post("holds/release-expired")
  releaseExpired() {
    return this.reservation.releaseExpired().then((released) => ({ released }));
  }
}
