import { Injectable, UnauthorizedException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { AdminDb } from "../database/admin-db.service";
import { signToken } from "./jwt";

/**
 * Autenticación. Usa AdminDb (privilegiado) porque la búsqueda de usuario y
 * membership es cross-tenant y ocurre antes de tener contexto de tenant.
 */
@Injectable()
export class AuthService {
  constructor(private readonly admin: AdminDb) {}

  async login(email: string, password: string, tenantSlug?: string) {
    const [u] = await this.admin.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);

    // Comparación siempre, exista o no el usuario, para no filtrar por timing.
    const hash = u?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinv";
    const ok = await bcrypt.compare(password, hash);
    if (!u || !ok) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    // Admin de PLATAFORMA (Admin SaaS): no tiene tenant. Login sin tenantSlug →
    // JWT con rol admin_saas y tenant vacío (los endpoints /platform van por AdminDb).
    if (u.platformAdmin && !tenantSlug) {
      const token = signToken({ sub: u.id, tenant_id: "", role: "admin_saas" });
      return { token, tenant: null, role: "admin_saas", platform: true };
    }

    // Membership(s) del usuario. Si pertenece a varios tenants, se exige tenantSlug.
    const memberships = await this.admin.db
      .select({
        tenantId: schema.membership.tenantId,
        role: schema.membership.role,
        slug: schema.tenant.slug,
      })
      .from(schema.membership)
      .innerJoin(schema.tenant, eq(schema.tenant.id, schema.membership.tenantId))
      .where(
        tenantSlug
          ? and(
              eq(schema.membership.userId, u.id),
              eq(schema.tenant.slug, tenantSlug),
            )
          : eq(schema.membership.userId, u.id),
      );

    if (memberships.length === 0) {
      throw new UnauthorizedException("El usuario no pertenece a ningún tenant");
    }
    if (memberships.length > 1) {
      throw new UnauthorizedException(
        "El usuario pertenece a varios tenants: indica tenantSlug",
      );
    }

    const m = memberships[0];
    const token = signToken({ sub: u.id, tenant_id: m.tenantId, role: m.role });
    return { token, tenant: m.slug, role: m.role };
  }
}
