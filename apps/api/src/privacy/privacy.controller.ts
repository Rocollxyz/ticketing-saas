import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrivacyService } from "./privacy.service";

/** Derechos de acceso y supresión (RGPD) para el promotor. JWT; rol en el servicio. */
@Controller("privacy")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("search")
  search(@Query("email") email: string) {
    return this.privacy.search(email);
  }

  /** Lo mismo que la búsqueda, como fichero JSON para entregar al interesado. */
  @Get("export")
  async export(@Query("email") email: string, @Res({ passthrough: true }) res: Response) {
    const data = await this.privacy.search(email);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="datos-personales.json"`);
    res.setHeader("Cache-Control", "no-store");
    return JSON.stringify(data, null, 2);
  }

  @Post("erase")
  erase(@Body() body: { email?: unknown }) {
    return this.privacy.erase(body?.email);
  }
}
