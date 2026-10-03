import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/**
 * API pública de la tienda (web de compra). Sin JWT: el promotor va en la URL
 * (:slug). Excluida del TenantMiddleware en AppModule.
 */
@Controller("shop/:slug")
export class StorefrontController {
  constructor(private readonly shop: StorefrontService) {}

  @Get("profile")
  profile(@Param("slug") slug: string) {
    return this.shop.profile(slug);
  }

  // Ruta estática ANTES de "events/:eventId" para que "past" no se tome por un id.
  @Get("events/past")
  pastEvents(@Param("slug") slug: string) {
    return this.shop.pastEvents(slug);
  }

  @Get("events")
  events(@Param("slug") slug: string) {
    return this.shop.listEvents(slug);
  }

  @Get("events/:eventId")
  event(@Param("slug") slug: string, @Param("eventId") eventId: string) {
    return this.shop.getEvent(slug, eventId);
  }

  @Get("events/:eventId/confirmation")
  confirmation(@Param("slug") slug: string, @Param("eventId") eventId: string) {
    return this.shop.confirmation(slug, eventId);
  }

  @Post("holds")
  hold(
    @Param("slug") slug: string,
    @Body()
    body: { eventId: string; seatIds?: string[]; quantities?: Record<string, number>; sessionId?: string },
  ) {
    const sessionId = body.sessionId ?? randomUUID();
    return this.shop
      .createHold(slug, body.eventId, { seatIds: body.seatIds, quantities: body.quantities }, sessionId)
      // serverNow: el navegador calcula el tiempo restante sin fiarse de su reloj.
      .then((r) => ({ ...r, sessionId, serverNow: new Date() }));
  }

  @Post("holds/:holdId/release")
  release(
    @Param("slug") slug: string,
    @Param("holdId") holdId: string,
    @Body() body: { sessionId?: string },
  ) {
    return this.shop.releaseHold(slug, holdId, body?.sessionId ?? "");
  }

  @Post("checkout")
  checkout(
    @Param("slug") slug: string,
    @Body() body: { holdId: string; buyerEmail?: string; buyerName?: unknown; attendees?: unknown },
  ) {
    return this.shop.createCheckout(slug, body.holdId, body.buyerEmail, {
      name: body.buyerName,
      attendees: body.attendees,
    });
  }
}
