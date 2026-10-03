import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membershipRole, pk, timestamps } from "./_shared";

/**
 * Identidad y tenancy (§5). `tenant` es la raíz del aislamiento: no lleva
 * tenant_id porque *es* el tenant. El rol vive en `membership`, no en `user`,
 * para evitar escalada de privilegios entre tenants.
 */

export const tenant = pgTable("tenant", {
  id: pk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Perfil PÚBLICO del promotor (cabecera de su página en la tienda). Todo opcional.
  tagline: text("tagline"), // frase corta bajo el nombre
  description: text("description"),
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  accentColor: text("accent_color"), // #rrggbb: botones/enlaces de su página
  city: text("city"),
  contactEmail: text("contact_email"),
  phone: text("phone"),
  website: text("website"),
  instagram: text("instagram"),
  facebook: text("facebook"),
  tiktok: text("tiktok"),
  x: text("x"),
  youtube: text("youtube"),
  ...timestamps,
});

export const user = pgTable("user", {
  id: pk(),
  email: text("email").notNull().unique(), // único global
  passwordHash: text("password_hash").notNull(), // Argon2/bcrypt
  name: text("name"),
  // Operador de la PLATAFORMA (Admin SaaS): opera por encima de los tenants, no
  // tiene membership. Login sin tenantSlug → JWT con rol admin_saas.
  platformAdmin: boolean("platform_admin").notNull().default(false),
  ...timestamps,
});

export const membership = pgTable(
  "membership",
  {
    id: pk(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    ...timestamps,
  },
  (t) => [
    // un usuario tiene un único rol por tenant
    uniqueIndex("membership_user_tenant_uq").on(t.userId, t.tenantId),
  ],
);
