import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { type SeatmapChanges, SeatmapService } from "./seatmap.service";

/**
 * API del editor de mapa (promotor). Autenticada por JWT (NO está excluida del
 * TenantMiddleware): el tenant sale del token, así que cada promotor solo toca sus
 * eventos. La web pública de compra usa otra ruta (storefront).
 */
@Controller("events/:eventId/seatmap")
export class SeatmapController {
  constructor(private readonly seatmap: SeatmapService) {}

  @Get()
  get(@Param("eventId") eventId: string) {
    return this.seatmap.getSeatmap(eventId);
  }

  @Put()
  save(@Param("eventId") eventId: string, @Body() body: SeatmapChanges) {
    return this.seatmap.saveSeatmap(eventId, body ?? {});
  }
}
