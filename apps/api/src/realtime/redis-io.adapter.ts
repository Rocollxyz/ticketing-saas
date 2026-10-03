import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { ServerOptions } from "socket.io";

/**
 * Adaptador de socket.io respaldado por Redis (pub/sub). Sin esto, un broadcast
 * solo llega a los clientes conectados a LA MISMA instancia de la API; con varias
 * réplicas detrás de un balanceador (el objetivo de despliegue, §8) un comprador en
 * la réplica A no vería el hold de otro en la réplica B. Redis propaga los eventos
 * entre instancias. Si Redis no está disponible, se degrada a modo in-process.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(): Promise<boolean> {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    // Fail-fast: si Redis no está, se RINDE tras unos reintentos (la estrategia
    // devuelve un Error) en vez de reintentar para siempre y bloquear el arranque.
    // Entonces connect() rechaza y main.ts degrada a modo in-process.
    const opts = {
      url,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries: number) =>
          retries > 3 ? new Error("Redis no disponible") : Math.min(retries * 200, 800),
      },
    };
    const pubClient = createClient(opts);
    const subClient = pubClient.duplicate();
    pubClient.on("error", (e) => this.logger.warn(`redis pub: ${e.message}`));
    subClient.on("error", (e) => this.logger.warn(`redis sub: ${e.message}`));
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
    } catch (e) {
      await Promise.allSettled([pubClient.disconnect(), subClient.disconnect()]);
      throw e;
    }
    this.adapterConstructor = createAdapter(pubClient, subClient);
    return true;
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
