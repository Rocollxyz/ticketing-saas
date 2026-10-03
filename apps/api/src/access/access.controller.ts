import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { AccessService, type OfflineCheckIn } from "./access.service";

/**
 * API de control de acceso (app del portero). Autenticada por JWT (rol portero/
 * promotor; el guard está en el servicio). El tenant sale del token.
 */
@Controller("access")
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Post("scan")
  scan(@Body() body: { token: string; deviceId?: string }) {
    return this.access.scan(body.token ?? "", body.deviceId);
  }

  @Get("manifest/:eventId")
  async manifest(@Param("eventId") eventId: string) {
    const m = await this.access.manifest(eventId);
    if (!m) throw new NotFoundException("Evento no encontrado");
    return m;
  }

  @Post("sync")
  sync(@Body() body: { checkins: OfflineCheckIn[] }) {
    return this.access.sync(body.checkins ?? []);
  }
}
