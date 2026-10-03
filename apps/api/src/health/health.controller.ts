import { Controller, Get } from "@nestjs/common";

/**
 * Health check sin contexto de tenant (excluido del TenantMiddleware).
 */
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok", ts: new Date().toISOString() };
  }
}
