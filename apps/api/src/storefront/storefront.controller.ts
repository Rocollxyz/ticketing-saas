import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RateLimit } from "../security/rate-limit.guard";
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

  /** Reservar bloquea aforo: sin límite, un bot podría dejar un evento «agotado». */
  @Post("holds")
  @RateLimit({ name: "shop-hold", limit: 30, windowSec: 600 })
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
  @RateLimit({ name: "shop-checkout", limit: 20, windowSec: 600 })
  checkout(
    @Param("slug") slug: string,
    @Body()
    body: {
      holdId: string;
      buyerEmail?: string;
      buyerName?: unknown;
      attendees?: unknown;
      couponCode?: unknown;
      billing?: unknown;
      method?: unknown;
    },
  ) {
    return this.shop.createCheckout(slug, body.holdId, body.buyerEmail, {
      name: body.buyerName,
      attendees: body.attendees,
      couponCode: body.couponCode,
      billing: body.billing,
      method: body.method,
    });
  }

  /**
   * Vuelta desde la pasarela por redirección (Redsys) con el resultado firmado
   * ({ Ds_SignatureVersion, Ds_MerchantParameters, Ds_Signature }). Devuelve el estado.
   */
  // Sin límite por IP: la llama el SERVIDOR de la tienda (todos los compradores tendrían la
  // misma IP). La protege la firma de Redsys y es idempotente.
  @Post("orders/:orderId/confirm-return")
  confirmReturn(@Param("slug") slug: string, @Param("orderId") orderId: string, @Body() body: Record<string, unknown>) {
    return this.shop.confirmReturn(slug, orderId, body ?? {});
  }

  /** Comprueba un código de descuento: { eventId, seatIds | quantities, code }. */
  /** Evita adivinar códigos de descuento probando. */
  @Post("coupons/quote")
  @RateLimit({ name: "shop-coupon", limit: 15, windowSec: 600 })
  quoteCoupon(
    @Param("slug") slug: string,
    @Body() body: { eventId?: string; seatIds?: unknown; quantities?: unknown; code?: unknown },
  ) {
    return this.shop.quoteCoupon(slug, body?.eventId ?? "", body ?? {}, body?.code);
  }
}
