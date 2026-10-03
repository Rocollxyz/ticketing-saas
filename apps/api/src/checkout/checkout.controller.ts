import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { CheckoutService } from "./checkout.service";

@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** Inicia el pago de un hold (requiere JWT). Devuelve clientSecret. */
  @Post("checkout")
  create(@Body() body: { holdId: string; buyerEmail?: string }) {
    return this.checkout.createCheckout(body.holdId, body.buyerEmail);
  }

  /**
   * Webhook del proveedor de pago. PÚBLICO (sin JWT) y verificado por firma. Usa el
   * cuerpo CRUDO (rawBody) para que la verificación de firma sea correcta.
   */
  @Post("webhooks/:provider")
  webhook(
    @Param("provider") provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody?.toString("utf8") ?? "";
    const headers = req.headers as Record<string, string | undefined>;
    return this.checkout.handleWebhook(provider, raw, headers);
  }
}
