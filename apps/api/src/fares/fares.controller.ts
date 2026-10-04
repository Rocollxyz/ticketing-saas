import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { FaresService } from "./fares.service";

/** Tarifas de un evento (JWT; rol comprobado en el servicio). */
@Controller("events/:eventId/fares")
export class FaresController {
  constructor(private readonly fares: FaresService) {}

  @Get()
  list(@Param("eventId") eventId: string) {
    return this.fares.list(eventId);
  }

  @Post()
  create(@Param("eventId") eventId: string, @Body() body: Record<string, unknown>) {
    return this.fares.create(eventId, body ?? {});
  }

  @Patch(":id")
  update(@Param("eventId") eventId: string, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.fares.update(eventId, id, body ?? {});
  }

  @Delete(":id")
  remove(@Param("eventId") eventId: string, @Param("id") id: string) {
    return this.fares.remove(eventId, id);
  }
}
