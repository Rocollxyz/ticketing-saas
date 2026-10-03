import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { tenant } from "./tenancy";

/**
 * Robustez de pagos e infraestructura (§5). Estas tablas no son de un tenant
 * concreto en el caso del webhook (llegan antes de resolver el tenant), por eso
 * processed_webhook_event no lleva tenant_id obligatorio.
 */

// Idempotencia de webhooks (§4): un evento reintentado por la pasarela se detecta
// por (provider, event_id) y se ignora.
export const processedWebhookEvent = pgTable(
  "processed_webhook_event",
  {
    id: pk(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(), // id del evento en el proveedor
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("processed_webhook_event_uq").on(t.provider, t.eventId)],
);

// Auditoría append-only de acciones sensibles (GDPR y trazabilidad).
export const auditLog = pgTable("audit_log", {
  id: pk(),
  tenantId: uuid("tenant_id").references(() => tenant.id, { onDelete: "restrict" }), // NULL = fila de sistema
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  diff: jsonb("diff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Transactional outbox: efectos externos escritos en la misma transacción que el
// cambio de estado; un worker los procesa. Evita "cobrado pero sin entrada".
export const outbox = pgTable("outbox", {
  id: pk(),
  tenantId: uuid("tenant_id").references(() => tenant.id, { onDelete: "restrict" }), // NULL = fila de sistema
  type: text("type").notNull(), // p.ej. "ticket.issue", "email.send"
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...timestamps,
});
