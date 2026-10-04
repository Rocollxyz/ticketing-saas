import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { schema } from "@ticketing/database";
import * as bcrypt from "bcryptjs";
import { count, eq, inArray, sum } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { getStore } from "../database/tenant-context";

export interface CreateTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
}

/**
 * Admin SaaS (Fase 6): operación de la PLATAFORMA, por encima de todos los tenants.
 * Solo el rol `admin_saas`. Va por AdminDb (privilegiada, fuera de RLS) porque es
 * trabajo cross-tenant. `createTenant` es el onboarding real de promotores y resuelve
 * el chicken-and-egg de RLS (B3 en SECURITY_AUDIT): el alta necesita un rol de
 * provisión privilegiado, que es justo este.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly admin: AdminDb) {}

  private assertPlatformAdmin() {
    if (getStore()?.role !== "admin_saas") {
      throw new ForbiddenException("Solo el administrador de la plataforma");
    }
  }

  /** Todos los promotores (tenants) con métricas básicas. */
  async listTenants() {
    this.assertPlatformAdmin();

    const tenants = await this.admin.db
      .select({
        id: schema.tenant.id,
        name: schema.tenant.name,
        slug: schema.tenant.slug,
        createdAt: schema.tenant.createdAt,
      })
      .from(schema.tenant);

    const events = await this.admin.db
      .select({ tenantId: schema.event.tenantId, c: count() })
      .from(schema.event)
      .groupBy(schema.event.tenantId);
    const tickets = await this.admin.db
      .select({ tenantId: schema.ticket.tenantId, c: count() })
      .from(schema.ticket)
      .groupBy(schema.ticket.tenantId);
    const revenue = await this.admin.db
      .select({ tenantId: schema.payment.tenantId, s: sum(schema.payment.amountCents) })
      .from(schema.payment)
      .where(inArray(schema.payment.status, ["CAPTURED", "REFUNDED"]))
      .groupBy(schema.payment.tenantId);
    // Recaudación neta: menos lo ya devuelto.
    const refunded = await this.admin.db
      .select({ tenantId: schema.refund.tenantId, s: sum(schema.refund.amountCents) })
      .from(schema.refund)
      .where(eq(schema.refund.status, "SUCCEEDED"))
      .groupBy(schema.refund.tenantId);

    const evMap = new Map(events.map((r) => [r.tenantId, Number(r.c)]));
    const tkMap = new Map(tickets.map((r) => [r.tenantId, Number(r.c)]));
    const refMap = new Map(refunded.map((r) => [r.tenantId, Number(r.s ?? 0)]));
    const revMap = new Map(revenue.map((r) => [r.tenantId, Number(r.s ?? 0) - (refMap.get(r.tenantId) ?? 0)]));

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      eventsCount: evMap.get(t.id) ?? 0,
      ticketsCount: tkMap.get(t.id) ?? 0,
      revenueCents: revMap.get(t.id) ?? 0,
    }));
  }

  /** Alta de un promotor: tenant + usuario admin + membership(promotor). */
  async createTenant(input: CreateTenantInput) {
    this.assertPlatformAdmin();
    const name = input.name?.trim();
    const slug = input.slug?.trim().toLowerCase();
    const adminEmail = input.adminEmail?.trim().toLowerCase();
    const adminPassword = input.adminPassword;

    if (!name || !slug || !adminEmail || !adminPassword) {
      throw new BadRequestException("Faltan datos (name, slug, adminEmail, adminPassword)");
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new BadRequestException("slug inválido: solo minúsculas, números y guiones");
    }
    if (adminPassword.length < 8) {
      throw new BadRequestException("La contraseña debe tener al menos 8 caracteres");
    }

    const [slugTaken] = await this.admin.db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, slug));
    if (slugTaken) throw new ConflictException("Ese slug ya está en uso");

    const [emailTaken] = await this.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, adminEmail));
    if (emailTaken) throw new ConflictException("Ese email ya está registrado");

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    return this.admin.db.transaction(async (tx) => {
      const [t] = await tx.insert(schema.tenant).values({ name, slug }).returning();
      const [u] = await tx
        .insert(schema.user)
        .values({ email: adminEmail, passwordHash, name: `Admin ${name}` })
        .returning();
      await tx.insert(schema.membership).values({ tenantId: t.id, userId: u.id, role: "promotor" });
      return { id: t.id, name: t.name, slug: t.slug, adminEmail };
    });
  }
}
