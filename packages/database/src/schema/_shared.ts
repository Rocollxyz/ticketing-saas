import { sql } from "drizzle-orm";
import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Helpers y enums compartidos por todo el esquema (§5 ARCHITECTURE.md).
 */

// PK UUID. Nota: usamos gen_random_uuid() (v4) porque Postgres 17 aún no trae
// uuidv7() nativo. Migrar a v7 cuando esté disponible (pg_uuidv7 / PG18) para
// recuperar la localidad temporal en índices sin filtrar conteos.
export const pk = () =>
  uuid("id").primaryKey().default(sql`gen_random_uuid()`);

// Columna de aislamiento multi-tenant. Presente en TODA tabla de negocio (§5/§7).
export const tenantId = () => uuid("tenant_id").notNull();

// Auditoría estándar.
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// Borrado lógico para entidades con valor histórico/fiscal (nunca DELETE físico).
export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// ─── Enums de estado (transiciones garantizadas por la BD) ───
export const membershipRole = pgEnum("membership_role", [
  "promotor",
  "taquillero",
  "portero",
  "admin_saas",
]);

// CANCELLED es terminal (cancelado por el promotor). "Agotado" NO es un estado: se
// deriva de la disponibilidad.
export const eventStatus = pgEnum("event_status", ["DRAFT", "ON_SALE", "CLOSED", "CANCELLED"]);

// PUBLIC: aparece en el listado de la tienda. UNLISTED: solo accesible con el enlace.
export const eventVisibility = pgEnum("event_visibility", ["PUBLIC", "UNLISTED"]);

// RESERVED: asientos numerados (plano). GENERAL: entrada general, aforo por categoría
// (internamente cada plaza es un `seat` is_general, para reutilizar la anti-sobreventa).
export const seatingMode = pgEnum("seating_mode", ["RESERVED", "GENERAL"]);

// Tipos de campo del formulario de asistentes. `dni` = DNI/NIE español (con letra de control).
export const attendeeFieldType = pgEnum("attendee_field_type", [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "select",
  "checkbox",
  "date",
  "dni",
]);

/** Respuesta guardada de un asistente: copia FIJA de la etiqueta en el momento de comprar. */
export interface AttendeeAnswer {
  fieldId: string;
  label: string;
  value: string;
  /** Se imprime en la entrada (PDF/taquilla). */
  onTicket?: boolean;
  /** Campo estándar del que procede (p.ej. "name"). */
  preset?: string;
}

// Cupones: PERCENT = % sobre el precio de cada entrada; AMOUNT = céntimos menos por entrada.
export const couponKind = pgEnum("coupon_kind", ["PERCENT", "AMOUNT"]);

export const holdStatus = pgEnum("hold_status", [
  "ACTIVE",
  "CONFIRMED",
  "EXPIRED",
  "RELEASED",
]);

export const orderStatus = pgEnum("order_status", ["PENDING", "PAID", "CANCELLED"]);

export const paymentProvider = pgEnum("payment_provider", ["stripe", "redsys", "tpv", "cash"]);

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
]);

export const ticketStatus = pgEnum("ticket_status", ["ISSUED", "CHECKED_IN", "VOID"]);

export const checkInResult = pgEnum("check_in_result", ["OK", "DUPLICATE", "INVALID"]);
