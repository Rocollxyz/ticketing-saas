import { Body, Controller, Get, Post } from "@nestjs/common";
import { type CreateTenantInput, PlatformService } from "./platform.service";

/**
 * API del Admin SaaS (consola de plataforma). Autenticada por JWT con rol
 * admin_saas (guard en el servicio). NO lleva contexto de tenant: opera sobre todos.
 */
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("tenants")
  tenants() {
    return this.platform.listTenants();
  }

  @Post("tenants")
  createTenant(@Body() body: CreateTenantInput) {
    return this.platform.createTenant(body);
  }
}
