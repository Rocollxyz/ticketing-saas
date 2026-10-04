import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CouponsService } from "./coupons.service";

/** Códigos de descuento del promotor (JWT; rol comprobado en el servicio). */
@Controller("coupons")
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /** ?eventId= → los de ese evento + los de todos los eventos. */
  @Get()
  list(@Query("eventId") eventId?: string) {
    return this.coupons.list(eventId || undefined);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.coupons.create(body ?? {});
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.coupons.update(id, body ?? {});
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.coupons.remove(id);
  }
}
