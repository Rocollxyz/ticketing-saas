import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../auth/jwt";
import { tenantContext } from "../database/tenant-context";

/**
 * Auth + contexto de tenant. Verifica el JWT (Authorization: Bearer <token>) y
 * deja {tenantId, userId, role} en el AsyncLocalStorage para toda la vida del
 * request. El tenant sale del claim `tenant_id` de un token FIRMADO y verificado,
 * nunca de una cabecera que el cliente pueda falsear.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Falta token Bearer");
    }
    const token = header.slice("Bearer ".length).trim();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new UnauthorizedException("Token inválido o expirado");
    }

    tenantContext.run(
      { tenantId: payload.tenant_id, userId: payload.sub, role: payload.role },
      () => next(),
    );
  }
}
