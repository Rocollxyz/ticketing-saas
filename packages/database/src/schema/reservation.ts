import { sql } from "drizzle-orm";
import { bigint, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { type AttendeeAnswer, holdStatus, refundStatus, orderStatus, paymentProvider, paymentStatus, pk, tenantId, ticketStatus, timestamps } from "./_shared";
import { coupon, event, seat } from "./catalog";
import { tenant } from "./tenancy";

/**
 * Motor de reserva — núcleo del sistema (§4 y §5). Aquí vive la garantía
 * anti-sobreventa por esquema y el bloqueo optimista (columna version).
 */

export const order = pgTable(
  "order",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    status: orderStatus("status").notNull().default("PENDING"),
    buyerEmail: text("buyer_email"),
    buyerName: text("buyer_name"),
    couponId: uuid("coupon_id"),
    discountCents: bigint("discount_cents", { mode: "bigint" }).notNull().default(sql`0`),
    ...timestamps,
  },
  (t) => [
    unique("order_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.couponId],
      foreignColumns: [coupon.tenantId, coupon.id],
      name: "order_coupon_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "order_event_fk",
    }),
  ],
);

export const hold = pgTable(
  "hold",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    orderId: uuid("order_id"),
    sessionId: text("session_id").notNull(),
    status: holdStatus("status").notNull().default("ACTIVE"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(0), // bloqueo optimista
    ...timestamps,
  },
  (t) => [
    unique("hold_tenant_id_uq").on(t.tenantId, t.id),
    index("hold_expires_at_idx").on(t.expiresAt), // barrido de expiración
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "hold_event_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [order.tenantId, order.id],
      name: "hold_order_fk",
    }),
  ],
);

export const holdSeat = pgTable(
  "hold_seat",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    holdId: uuid("hold_id").notNull(),
    eventId: uuid("event_id").notNull(),
    seatId: uuid("seat_id").notNull(),
    // status replica el del hold para poder construir el índice único parcial.
    status: holdStatus("status").notNull().default("ACTIVE"),
    // Datos del asistente de ESTA plaza, recogidos en el checkout (antes de pagar). Se
    // copian a la entrada al emitirla.
    attendee: jsonb("attendee").$type<AttendeeAnswer[]>(),
    // Lo que se cobra por ESTA plaza (precio vigente menos su parte del descuento),
    // fijado al iniciar el pago. Se copia a la entrada al emitirla.
    priceCents: bigint("price_cents", { mode: "number" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.holdId],
      foreignColumns: [hold.tenantId, hold.id],
      name: "hold_seat_hold_fk",
    }),
    foreignKey({
      // Asiento del MISMO evento: la anti-sobreventa indexa por (event_id, seat_id),
      // así que un asiento de otro evento la eludiría.
      columns: [t.tenantId, t.eventId, t.seatId],
      foreignColumns: [seat.tenantId, seat.eventId, seat.id],
      name: "hold_seat_seat_fk",
    }),
    // ANTI-SOBREVENTA POR ESQUEMA: a lo sumo un hold ACTIVE/CONFIRMED por asiento.
    // La BD rechaza la doble reserva aunque la aplicación falle (§5).
    uniqueIndex("hold_seat_active_uq")
      .on(t.eventId, t.seatId)
      .where(sql`status IN ('ACTIVE','CONFIRMED')`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    provider: paymentProvider("provider").notNull(),
    providerRef: text("provider_ref"), // token/ref — NUNCA datos de tarjeta (SAQ-A)
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: paymentStatus("status").notNull().default("PENDING"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [order.tenantId, order.id],
      name: "payment_order_fk",
    }),
  ],
);

export const ticket = pgTable(
  "ticket",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    seatId: uuid("seat_id").notNull(),
    orderId: uuid("order_id").notNull(),
    status: ticketStatus("status").notNull().default("ISSUED"),
    qrKeyId: uuid("qr_key_id"), // referencia a event_signing_key; QR no en claro
    attendeeName: text("attendee_name"), // del campo "name" (entradas nominativas, búsqueda)
    attendee: jsonb("attendee").$type<AttendeeAnswer[]>(),
    // Pagado por esta entrada, ya con descuento. null = emitida antes de guardarlo.
    priceCents: bigint("price_cents", { mode: "number" }),
    ...timestamps,
  },
  (t) => [
    unique("ticket_tenant_id_uq").on(t.tenantId, t.id),
    // Un asiento con a lo sumo UNA entrada viva por evento. Parcial: una entrada VOID
    // (reembolso/anulación) no debe bloquear para siempre la reemisión del asiento.
    uniqueIndex("ticket_seat_uq")
      .on(t.eventId, t.seatId)
      .where(sql`status <> 'VOID'`),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "ticket_event_fk",
    }),
    foreignKey({
      // Asiento del MISMO evento: la anti-sobreventa indexa por (event_id, seat_id),
      // así que un asiento de otro evento la eludiría.
      columns: [t.tenantId, t.eventId, t.seatId],
      foreignColumns: [seat.tenantId, seat.eventId, seat.id],
      name: "ticket_seat_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [order.tenantId, order.id],
      name: "ticket_order_fk",
    }),
  ],
);

/**
 * Devolución de dinero de un pedido (total o de algunas entradas). Se crea en la misma
 * transacción que anula las entradas; el outbox la envía a la pasarela con su id como
 * clave de idempotencia (un reintento nunca devuelve dos veces).
 */
export const refund = pgTable(
  "refund",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: refundStatus("status").notNull(),
    ticketIds: jsonb("ticket_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    reason: text("reason"),
    providerRef: text("provider_ref"), // id de la devolución en la pasarela
    error: text("error"),
    createdBy: uuid("created_by"), // null = sistema (p.ej. cobro sin plaza)
    ...timestamps,
  },
  (t) => [
    index("refund_order_idx").on(t.orderId),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [order.tenantId, order.id],
      name: "refund_order_fk",
    }),
  ],
);
