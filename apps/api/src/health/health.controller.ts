import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { RateLimitService } from "../security/rate-limit.service";

/**
 * Health check sin contexto de tenant (excluido del TenantMiddleware). Comprueba las
 * dependencias: sin Postgres la API no sirve (503 → el balanceador la saca); sin Redis
 * sigue funcionando degradada (tiempo real y límites por réplica), así que solo avisa.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly admin: AdminDb,
    private readonly limits: RateLimitService,
  ) {}

  @Get()
  async check() {
    const timeout = <T>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2_000))]);
    const postgres = await timeout(this.admin.db.execute(sql`select 1`)).then(() => true, () => false);
    const redis = await timeout(this.limits.redisOk()).catch(() => false);
    const body = { status: postgres ? (redis ? "ok" : "degraded") : "down", postgres, redis, ts: new Date().toISOString() };
    if (!postgres) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
