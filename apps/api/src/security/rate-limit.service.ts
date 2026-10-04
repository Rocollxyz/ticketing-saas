import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

/**
 * Contadores de peticiones por ventana fija. En Redis (compartidos entre réplicas); si
 * Redis no responde, en memoria del proceso: mejor un límite por réplica que tumbar la
 * venta o dejar de limitar (fail-soft).
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private redis: RedisClientType | null = null;
  private readonly memory = new Map<string, { n: number; until: number }>();

  async onModuleInit() {
    const client: RedisClientType = createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
      socket: { connectTimeout: 2_000, reconnectStrategy: (n: number) => Math.min(n * 500, 5_000) },
    });
    client.on("error", () => {}); // los fallos se gestionan en hit(): pasa a memoria
    try {
      await client.connect();
      this.redis = client;
    } catch {
      this.logger.warn("Redis no disponible: límites de peticiones en memoria (por réplica)");
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
  }

  /** ¿Responde Redis? (para el health check). */
  async redisOk(): Promise<boolean> {
    if (!this.redis?.isReady) return false;
    return this.redis.ping().then(() => true, () => false);
  }

  /** Cuenta una petición. `retryAfter` (s) cuando se ha pasado del límite. */
  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfter: number }> {
    const k = `rl:${key}`;
    if (this.redis?.isReady) {
      try {
        const [n, , ttl] = await this.redis.multi().incr(k).expire(k, windowSec, "NX").ttl(k).exec();
        return { allowed: Number(n) <= limit, retryAfter: Math.max(1, Number(ttl)) };
      } catch {
        // cae a memoria
      }
    }
    const now = Date.now();
    const e = this.memory.get(k);
    if (!e || e.until <= now) {
      this.memory.set(k, { n: 1, until: now + windowSec * 1000 });
      if (this.memory.size > 50_000) this.sweep(now);
      return { allowed: limit >= 1, retryAfter: windowSec };
    }
    e.n++;
    return { allowed: e.n <= limit, retryAfter: Math.max(1, Math.ceil((e.until - now) / 1000)) };
  }

  private sweep(now: number) {
    for (const [k, v] of this.memory) if (v.until <= now) this.memory.delete(k);
  }
}
