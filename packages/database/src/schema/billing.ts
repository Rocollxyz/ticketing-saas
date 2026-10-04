import { bigint, date, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { type BillingData, invoiceKind, pk, tenantId } from "./_shared";
import { order } from "./reservation";
import { tenant } from "./tenancy";

/** Emisor copiado en la factura (los datos fiscales pueden cambiar después). */
export interface InvoiceIssuer {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string | null;
}

/** Línea de factura: importes con impuesto incluido; base y cuota ya calculadas. */
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number; // con impuesto
  totalCents: number; // con impuesto
  rateBp: number;
  baseCents: number;
  taxCents: number;
  exemptReason?: string | null;
  ticketIds: string[];
}

/** Desglose por tipo impositivo (obligatorio cuando hay varios tipos). */
export interface TaxBreakdown {
  rateBp: number;
  baseCents: number;
  taxCents: number;
  exemptReason?: string | null;
}

/**
 * Factura expedida por el promotor al comprador. Inmutable: una corrección es otra
 * factura (rectificativa). Numeración correlativa sin huecos por serie (invoice_counter)
 * y registro encadenado con huella SHA-256 al estilo VERI*FACTU (record_hash/prev_hash).
 */
export const invoice = pgTable(
  "invoice",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    kind: invoiceKind("kind").notNull(),
    // Tipo VERI*FACTU: F1 completa, F2 simplificada, F3 completa en sustitución de
    // simplificada, R1 rectificativa, R5 rectificativa de simplificada.
    aeatType: text("aeat_type").notNull(),
    series: text("series").notNull(),
    number: integer("number").notNull(),
    fullNumber: text("full_number").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    operationDate: date("operation_date"), // fecha del cobro, si difiere de la de expedición
    rectifiesId: uuid("rectifies_id"),
    replacesId: uuid("replaces_id"), // canje de simplificada por completa
    refundId: uuid("refund_id"),
    issuer: jsonb("issuer").$type<InvoiceIssuer>().notNull(),
    customer: jsonb("customer").$type<BillingData>(),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
    taxes: jsonb("taxes").$type<TaxBreakdown[]>().notNull(),
    taxName: text("tax_name").notNull().default("IVA"),
    baseCents: bigint("base_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    // Registro de facturación encadenado (RD 1007/2023): huella del registro anterior
    // del mismo emisor + la propia, y el instante exacto con huso usado en la huella.
    prevHash: text("prev_hash"),
    recordHash: text("record_hash").notNull(),
    recordedAt: text("recorded_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("invoice_tenant_id_uq").on(t.tenantId, t.id),
    unique("invoice_number_uq").on(t.tenantId, t.series, t.number),
    // Idempotencia: una factura de cada clase por pedido y una rectificativa por devolución.
    uniqueIndex("invoice_order_kind_uq").on(t.orderId, t.kind).where(sql`kind <> 'RECTIFYING'`),
    uniqueIndex("invoice_refund_uq").on(t.refundId).where(sql`refund_id IS NOT NULL`),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [order.tenantId, order.id],
      name: "invoice_order_fk",
    }),
  ],
);

/**
 * Contadores por promotor: el último número de cada serie y la última huella de la
 * cadena (clave "__chain__"). Se bloquean FOR UPDATE al emitir → sin huecos ni saltos.
 */
export const invoiceCounter = pgTable(
  "invoice_counter",
  {
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    lastHash: text("last_hash"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);
