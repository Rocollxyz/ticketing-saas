import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { RateLimitService } from "./rate-limit.service";

export interface RateLimitRule {
  /** Nombre del límite (forma parte de la clave). */
  name: string;
  limit: number;
  windowSec: number;
  /** ip: por dirección; ip+email: por dirección y email del cuerpo (login). */
  by?: "ip" | "email";
}

const KEY = "rate-limits";

/**
 * Límite de peticiones de una ruta. Varias reglas a la vez: p. ej. el login limita por
 * email (fuerza bruta contra una cuenta) y por IP (contra muchas).
 */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(KEY, rules);

/** Aplica las reglas de @RateLimit. Responde 429 con Retry-After. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!rules?.length || ctx.getType() !== "http") return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? req.socket.remoteAddress ?? "?";
    for (const r of rules) {
      let who = ip;
      if (r.by === "email") {
        const email = (req.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string" || !email) continue;
        who = `email:${email.trim().toLowerCase().slice(0, 254)}`;
      }
      const { allowed, retryAfter } = await this.limits.hit(`${r.name}:${who}`, r.limit, r.windowSec);
      if (!allowed) {
        ctx.switchToHttp().getResponse<Response>().setHeader("Retry-After", String(retryAfter));
        const mins = Math.ceil(retryAfter / 60);
        throw new HttpException(
          `Demasiados intentos. Vuelve a probar en ${mins <= 1 ? "un minuto" : `${mins} minutos`}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
