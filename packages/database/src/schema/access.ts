import { foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { checkInResult, pk, tenantId, timestamps } from "./_shared";
import { event } from "./catalog";
import { ticket } from "./reservation";
import { tenant } from "./tenancy";

/**
 * Acceso y control (§5). `check_in` es append-only (pista forense y detección de
 * reentradas). `event_signing_key` guarda la clave de firma de QR por evento,
 * cifrada en reposo, para validación offline en la app de acceso.
 */

export const checkIn = pgTable(
  "check_in",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull(),
    deviceId: text("device_id"),
    result: checkInResult("result").notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    // append-only: sin updated_at ni deleted_at a propósito
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ticketId],
      foreignColumns: [ticket.tenantId, ticket.id],
      name: "check_in_ticket_fk",
    }),
  ],
);

export const eventSigningKey = pgTable(
  "event_signing_key",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    encryptedKey: text("encrypted_key").notNull(), // cifrada en reposo
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "event_signing_key_event_fk",
    }),
  ],
);
