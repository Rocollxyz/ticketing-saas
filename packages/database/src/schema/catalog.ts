import { bigint, boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { attendeeFieldType, couponKind, eventStatus, eventVisibility, pk, seatingMode, softDelete, tenantId, timestamps } from "./_shared";
import { tenant } from "./tenancy";

/**
 * Catálogo del evento (§5). Las FKs son COMPUESTAS con tenant_id para que sea
 * imposible por esquema referenciar datos de otro tenant. Cada tabla expone un
 * UNIQUE (tenant_id, id) que es el destino de esas FKs compuestas.
 */

export const venue = pgTable(
  "venue",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("ES"),
    mapsUrl: text("maps_url"),
    seatingMap: jsonb("seating_map"), // geometría validada en la app
    ...timestamps,
  },
  (t) => [unique("venue_tenant_id_uq").on(t.tenantId, t.id)],
);

export const event = pgTable(
  "event",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    venueId: uuid("venue_id"),
    name: text("name").notNull(),
    status: eventStatus("status").notNull().default("DRAFT"),
    summary: text("summary"), // frase corta para el listado
    description: text("description"),
    category: text("category"), // concierto, teatro, festival…
    imageUrl: text("image_url"),
    // Fechas en UTC; `timezone` (IANA) es la zona en la que se muestran/editan.
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    doorsAt: timestamp("doors_at", { withTimezone: true }), // apertura de puertas
    visibility: eventVisibility("visibility").notNull().default("PUBLIC"),
    seatingMode: seatingMode("seating_mode").notNull().default("RESERVED"),
    // Ventana de venta online del evento (null = desde publicar / hasta el inicio).
    salesStartAt: timestamp("sales_start_at", { withTimezone: true }),
    salesEndAt: timestamp("sales_end_at", { withTimezone: true }),
    maxPerOrder: integer("max_per_order").notNull().default(10),
    minAge: integer("min_age"),
    refundPolicy: text("refund_policy"),
    contactEmail: text("contact_email"),
    confirmationMessage: text("confirmation_message"), // tras la compra + email
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("event_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venue.tenantId, venue.id],
      name: "event_venue_fk",
    }),
  ],
);

export const zone = pgTable(
  "zone",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("zone_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "zone_event_fk",
    }),
  ],
);

export const ticketType = pgTable(
  "ticket_type",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    name: text("name").notNull(), // general, VIP, reducida…
    description: text("description"),
    // Aforo de la categoría en eventos de ENTRADA GENERAL (en numerados lo da el plano).
    capacity: integer("capacity"),
    // Ventana de venta online propia de la categoría (p.ej. "anticipada").
    salesStartAt: timestamp("sales_start_at", { withTimezone: true }),
    salesEndAt: timestamp("sales_end_at", { withTimezone: true }),
    minPerOrder: integer("min_per_order").notNull().default(1),
    maxPerOrder: integer("max_per_order"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Impuesto incluido en el precio, en centésimas de punto: 1000 = 10 % (espectáculos
    // culturales en vivo, art. 91.Uno.2.6º LIVA). 0 + motivo = exenta.
    taxRateBp: integer("tax_rate_bp").notNull().default(1000),
    taxExemptReason: text("tax_exempt_reason"),
    ...timestamps,
  },
  (t) => [
    unique("ticket_type_tenant_id_uq").on(t.tenantId, t.id),
    // Destino de la FK seat→ticket_type del MISMO evento.
    unique("ticket_type_event_id_uq").on(t.tenantId, t.eventId, t.id),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "ticket_type_event_fk",
    }),
  ],
);

/**
 * Formulario de asistentes del evento: qué datos se piden por CADA entrada (nombre,
 * DNI, campos propios…). `presetKey` marca los campos estándar (p.ej. "name" alimenta
 * el nombre del asistente que se imprime en la entrada y ve el portero).
 */
export const attendeeField = pgTable(
  "attendee_field",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    presetKey: text("preset_key"), // name | email | phone | company | job | dni | birthdate | null
    label: text("label").notNull(),
    type: attendeeFieldType("type").notNull(),
    required: boolean("required").notNull().default(false),
    helpText: text("help_text"),
    options: jsonb("options").$type<string[]>(), // solo para `select`
    // null = todas las categorías; si no, solo estas (p.ej. DNI solo en «VIP»).
    ticketTypeIds: jsonb("ticket_type_ids").$type<string[]>(),
    showOnTicket: boolean("show_on_ticket").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "attendee_field_event_fk",
    }),
  ],
);

/**
 * Código de descuento del promotor. `eventId` null = vale para todos sus eventos. El
 * descuento se aplica a CADA entrada elegible del pedido (nunca por debajo de 0). Los
 * usos se cuentan por pedidos no cancelados (ver CouponsService).
 */
export const coupon = pgTable(
  "coupon",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id"),
    code: text("code").notNull(), // siempre en MAYÚSCULAS
    kind: couponKind("kind").notNull(),
    value: integer("value").notNull(), // % (1-100) o céntimos
    // null = todas las categorías (solo tiene sentido con eventId).
    ticketTypeIds: jsonb("ticket_type_ids").$type<string[]>(),
    maxUses: integer("max_uses"), // null = ilimitado
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("coupon_tenant_id_uq").on(t.tenantId, t.id),
    unique("coupon_code_uq").on(t.tenantId, t.code),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "coupon_event_fk",
    }),
  ],
);

export const seat = pgTable(
  "seat",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    // Categoría de precio del asiento. Su importe sale de la `price` vigente del
    // ticket_type. Nullable para asientos aún sin categoría asignada.
    ticketTypeId: uuid("ticket_type_id"),
    fila: text("fila").notNull(),
    numero: integer("numero").notNull(),
    // Posición en el mapa de asientos (coordenadas de rejilla del editor del
    // promotor). Nullable: un asiento sin colocar aún no aparece en el plano.
    posX: integer("pos_x"),
    posY: integer("pos_y"),
    // Plaza de entrada general (sin ubicación): fila "GA", numeración por evento.
    isGeneral: boolean("is_general").notNull().default(false),
    ...timestamps,
    // El estado en vivo (AVAILABLE/HELD…) NO se guarda: se deriva de holds/tickets
    // activos (fuente única de verdad) y se cachea en Redis para tiempo real.
  },
  (t) => [
    unique("seat_tenant_id_uq").on(t.tenantId, t.id),
    // Destino de las FKs hold_seat/ticket → seat del MISMO evento.
    unique("seat_event_id_uq").on(t.tenantId, t.eventId, t.id),
    uniqueIndex("seat_pos_uq").on(t.eventId, t.zoneId, t.fila, t.numero),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [event.tenantId, event.id],
      name: "seat_event_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [zone.tenantId, zone.id],
      name: "seat_zone_fk",
    }),
    // Categoría del MISMO evento (con ticket_type_id NULL la FK no aplica).
    foreignKey({
      columns: [t.tenantId, t.eventId, t.ticketTypeId],
      foreignColumns: [ticketType.tenantId, ticketType.eventId, ticketType.id],
      name: "seat_ticket_type_fk",
    }),
  ],
);

export const price = pgTable(
  "price",
  {
    id: pk(),
    tenantId: tenantId().references(() => tenant.id, { onDelete: "restrict" }),
    ticketTypeId: uuid("ticket_type_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ticketTypeId],
      foreignColumns: [ticketType.tenantId, ticketType.id],
      name: "price_ticket_type_fk",
    }),
  ],
);
