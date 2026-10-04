import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { eq } from "drizzle-orm";
import { isValidSpanishTaxId, normalizeTaxId } from "../billing/tax";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

/**
 * Perfil público del promotor (cabecera de su página en la tienda). Bajo RLS: la
 * política de `tenant` solo deja ver/editar la fila del propio tenant. El slug no se
 * edita aquí (cambia las URLs públicas: lo gestiona la plataforma).
 */
@Injectable()
export class ProfileService {
  constructor(private readonly db: TenantDb) {}

  get() {
    return this.db.run(async (tx) => {
      const [t] = await tx.select().from(schema.tenant).where(eq(schema.tenant.id, getStore()!.tenantId));
      if (!t) throw new NotFoundException("Promotor no encontrado");
      return t;
    });
  }

  update(body: Record<string, unknown>) {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede editar su perfil");
    }
    const data = input.defined({
      // Obligatorio solo si se envía (PATCH): no puede quedar vacío.
      name: input.text(body.name, "Nombre", 120, body.name !== undefined) ?? undefined,
      tagline: input.text(body.tagline, "Lema", 160),
      description: input.text(body.description, "Descripción", 5_000),
      logoUrl: input.url(body.logoUrl, "Logo"),
      coverUrl: input.url(body.coverUrl, "Imagen de portada"),
      accentColor: input.hexColor(body.accentColor, "Color de marca"),
      city: input.text(body.city, "Ciudad", 100),
      contactEmail: input.email(body.contactEmail, "Email de contacto"),
      phone: input.text(body.phone, "Teléfono", 40),
      website: input.url(body.website, "Web"),
      instagram: input.social(body.instagram, "instagram", "Instagram"),
      facebook: input.social(body.facebook, "facebook", "Facebook"),
      tiktok: input.social(body.tiktok, "tiktok", "TikTok"),
      x: input.social(body.x, "x", "X"),
      youtube: input.social(body.youtube, "youtube", "YouTube"),
      // Datos fiscales (emisor de las facturas de las entradas).
      fiscalName: input.text(body.fiscalName, "Razón social", 200),
      taxId: taxIdOf(body.taxId),
      fiscalAddress: input.text(body.fiscalAddress, "Dirección fiscal", 300),
      fiscalPostalCode: input.text(body.fiscalPostalCode, "Código postal", 10),
      fiscalCity: input.text(body.fiscalCity, "Población", 100),
      fiscalProvince: input.text(body.fiscalProvince, "Provincia", 100),
      taxRegime: input.oneOf(body.taxRegime, "Impuesto", ["IVA", "IGIC"] as const),
    });
    return this.db.run(async (tx) => {
      const [t] = await tx
        .update(schema.tenant)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.tenant.id, getStore()!.tenantId))
        .returning();
      if (!t) throw new NotFoundException("Promotor no encontrado");
      return t;
    });
  }
}

/** NIF del promotor: DNI, NIE o CIF válidos. */
function taxIdOf(v: unknown) {
  const raw = input.text(v, "NIF", 20);
  if (raw == null) return raw;
  const n = normalizeTaxId(raw);
  if (!isValidSpanishTaxId(n)) throw new BadRequestException("NIF no válido (DNI, NIE o CIF)");
  return n;
}
