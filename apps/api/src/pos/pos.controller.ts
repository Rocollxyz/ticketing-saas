import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { type PosMethod, PosService } from "./pos.service";

/**
 * API del POS de taquilla. Autenticada por JWT (rol taquillero/promotor; guard en el
 * servicio). El tenant sale del token.
 */
@Controller("pos")
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get("events")
  events() {
    return this.pos.listEvents();
  }

  @Get("events/:eventId/seats")
  seats(@Param("eventId") eventId: string) {
    return this.pos.seats(eventId);
  }

  @Post("sell")
  sell(
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      quantities?: Record<string, number>;
      method: PosMethod;
      buyerEmail?: string;
    },
  ) {
    return this.pos.sell(
      body.eventId,
      { seatIds: body.seatIds, quantities: body.quantities },
      body.method,
      body.buyerEmail,
    );
  }
}
