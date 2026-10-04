import { type BillingData, schema, type InvoiceLine, type TaxBreakdown } from "@ticketing/database";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { TenantDb } from "../database/tenant-db.service";
import { aeatDate, aeatTimestamp, recordHash, splitGross } from "./tax";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];
type InvoiceRow = typeof schema.invoice.$inferSelect;
type Kind = InvoiceRow["kind"];

/**
 * Emisión de facturas. Funciones que reciben la transacción para poder usarse desde el
 * worker del outbox (AdminDb, sin RLS: pasa el tenant explícito) y desde la consola
 * (TenantDb). Todas son IDEMPOTENTES: repetirlas devuelve la factura ya emitida.
 *
 * Modelo: vende el PROMOTOR (la plataforma intermedia en su nombre), así que el emisor
 * es el promotor con sus datos fiscales. Sin datos fiscales no se factura (`skipped`).
 */

export type IssueResult = { invoice: InvoiceRow; created: boolean } | { skipped: string };

const SERIES_PREFIX: Record<Kind, string> = { SIMPLIFIED: "T", FULL: "F", RECTIFYING: "R" };

async function tenantIssuerTx(tx: Tx, tenantId: string) {
  const [t] = await tx.select().from(schema.tenant).where(eq(schema.tenant.id, tenantId));
  if (!t?.taxId || !t.fiscalName || !t.fiscalAddress || !t.fiscalPostalCode || !t.fiscalCity) return null;
  return {
    issuer: {
      name: t.fiscalName,
      taxId: t.taxId,
      address: t.fiscalAddress,
      postalCode: t.fiscalPostalCode,
      city: t.fiscalCity,
      province: t.fiscalProvince,
    },
    taxName: t.taxRegime === "IGIC" ? "IGIC" : "IVA",
  };
}

/** Bloquea (creándola si falta) la fila de contador `key` del promotor. */
async function lockCounterTx(tx: Tx, tenantId: string, key: string) {
  await tx.insert(schema.invoiceCounter).values({ tenantId, key }).onConflictDoNothing();
  const [c] = await tx
    .select()
    .from(schema.invoiceCounter)
    .where(and(eq(schema.invoiceCounter.tenantId, tenantId), eq(schema.invoiceCounter.key, key)))
    .for("update");
  return c;
}

/**
 * Numera, encadena e inserta. Orden de bloqueo fijo (cadena → serie) para no
 * interbloquearse: dos facturas simultáneas del mismo promotor se ponen en fila.
 */
async function insertInvoiceTx(
  tx: Tx,
  tenantId: string,
  data: Omit<typeof schema.invoice.$inferInsert, "tenantId" | "series" | "number" | "fullNumber" | "recordHash" | "prevHash" | "recordedAt" | "issuedAt">,
): Promise<InvoiceRow> {
  const now = new Date();
  const year = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", year: "numeric" }).format(now);
  const series = `${SERIES_PREFIX[data.kind]}${year}`;

  const chain = await lockCounterTx(tx, tenantId, "__chain__");
  const counter = await lockCounterTx(tx, tenantId, series);
  const number = counter.lastNumber + 1;
  const fullNumber = `${series}-${String(number).padStart(6, "0")}`;
  const recordedAt = aeatTimestamp(now);
  const hash = recordHash({
    issuerTaxId: data.issuer.taxId,
    fullNumber,
    issueDate: aeatDate(now),
    aeatType: data.aeatType,
    taxCents: data.taxCents,
    totalCents: data.totalCents,
    prevHash: chain.lastHash,
    recordedAt,
  });

  const [inv] = await tx
    .insert(schema.invoice)
    .values({
      ...data,
      tenantId,
      series,
      number,
      fullNumber,
      issuedAt: now,
      prevHash: chain.lastHash,
      recordHash: hash,
      recordedAt,
    })
    .returning();
  await tx
    .update(schema.invoiceCounter)
    .set({ lastNumber: number })
    .where(and(eq(schema.invoiceCounter.tenantId, tenantId), eq(schema.invoiceCounter.key, series)));
  await tx
    .update(schema.invoiceCounter)
    .set({ lastHash: hash })
    .where(and(eq(schema.invoiceCounter.tenantId, tenantId), eq(schema.invoiceCounter.key, "__chain__")));
  return inv;
}

/** Suma por tipo impositivo (desglose obligatorio) y totales. */
function totals(lines: InvoiceLine[]) {
  const byRate = new Map<string, TaxBreakdown>();
  for (const l of lines) {
    const k = `${l.rateBp}|${l.exemptReason ?? ""}`;
    const t = byRate.get(k) ?? { rateBp: l.rateBp, baseCents: 0, taxCents: 0, exemptReason: l.exemptReason ?? null };
    t.baseCents += l.baseCents;
    t.taxCents += l.taxCents;
    byRate.set(k, t);
  }
  const taxes = [...byRate.values()].sort((a, b) => b.rateBp - a.rateBp);
  return {
    taxes,
    baseCents: taxes.reduce((a, t) => a + t.baseCents, 0),
    taxCents: taxes.reduce((a, t) => a + t.taxCents, 0),
    totalCents: lines.reduce((a, l) => a + l.totalCents, 0),
  };
}

/** Pedido cobrado → líneas agrupadas por categoría, precio pagado y tipo. */
async function orderLinesTx(tx: Tx, orderId: string, paidCents: number) {
  const [o] = await tx
    .select({ eventName: schema.event.name, startsAt: schema.event.startsAt, timezone: schema.event.timezone })
    .from(schema.order)
    .innerJoin(schema.event, eq(schema.event.id, schema.order.eventId))
    .where(eq(schema.order.id, orderId));
  const tickets = await tx
    .select({
      id: schema.ticket.id,
      priceCents: schema.ticket.priceCents,
      typeName: schema.ticketType.name,
      rateBp: schema.ticketType.taxRateBp,
      exemptReason: schema.ticketType.taxExemptReason,
    })
    .from(schema.ticket)
    .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
    .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
    .where(eq(schema.ticket.orderId, orderId))
    .orderBy(asc(schema.ticket.createdAt));
  if (tickets.length === 0) return null;

  // Entradas antiguas sin precio guardado: el resto del cobro a partes iguales.
  const known = tickets.reduce((a, t) => a + (t.priceCents ?? 0), 0);
  const unknown = tickets.filter((t) => t.priceCents == null);
  const share = unknown.length ? Math.floor((paidCents - known) / unknown.length) : 0;
  let remainder = unknown.length ? paidCents - known - share * unknown.length : 0;

  const when = o.startsAt
    ? new Intl.DateTimeFormat("es-ES", { timeZone: o.timezone, dateStyle: "short" }).format(o.startsAt)
    : null;
  const groups = new Map<string, InvoiceLine>();
  for (const t of tickets) {
    let price = t.priceCents ?? share;
    if (t.priceCents == null && remainder > 0) {
      price += remainder;
      remainder = 0;
    }
    const rateBp = t.rateBp ?? 1000;
    const key = `${t.typeName}|${price}|${rateBp}`;
    const g = groups.get(key) ?? {
      description: `Entrada «${t.typeName ?? "General"}» — ${o.eventName}${when ? ` (${when})` : ""}`,
      quantity: 0,
      unitCents: price,
      totalCents: 0,
      rateBp,
      baseCents: 0,
      taxCents: 0,
      exemptReason: rateBp === 0 ? (t.exemptReason ?? null) : null,
      ticketIds: [],
    };
    g.quantity += 1;
    g.totalCents += price;
    g.ticketIds.push(t.id);
    groups.set(key, g);
  }
  const lines = [...groups.values()].filter((l) => l.totalCents > 0);
  for (const l of lines) Object.assign(l, splitGross(l.totalCents, l.rateBp));
  return lines;
}

/**
 * Factura de un pedido cobrado: completa si el comprador dio sus datos fiscales,
 * simplificada si no (hasta 400 €; por encima se emite igualmente y la consola avisa de
 * que hay que canjearla). Pedidos gratuitos e invitaciones no se facturan.
 */
export async function issueForOrderTx(tx: Tx, tenantId: string, orderId: string): Promise<IssueResult> {
  const [existing] = await tx
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.orderId, orderId), sql`${schema.invoice.kind} <> 'RECTIFYING'`))
    .orderBy(desc(schema.invoice.createdAt))
    .limit(1);
  if (existing) return { invoice: existing, created: false };

  const fiscal = await tenantIssuerTx(tx, tenantId);
  if (!fiscal) return { skipped: "Faltan los datos fiscales del promotor" };

  const [o] = await tx.select().from(schema.order).where(eq(schema.order.id, orderId));
  if (!o || o.status !== "PAID") return { skipped: "Pedido no pagado" };
  const [pay] = await tx
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.orderId, orderId), inArray(schema.payment.status, ["CAPTURED", "REFUNDED"])))
    .limit(1);
  if (!pay || Number(pay.amountCents) <= 0) return { skipped: "Sin cobro (gratis o invitación)" };

  const lines = await orderLinesTx(tx, orderId, Number(pay.amountCents));
  if (!lines?.length) return { skipped: "Pedido sin entradas" };
  const t = totals(lines);
  const full = !!o.billing;
  const inv = await insertInvoiceTx(tx, tenantId, {
    orderId,
    kind: full ? "FULL" : "SIMPLIFIED",
    aeatType: full ? "F1" : "F2",
    operationDate: pay.createdAt.toISOString().slice(0, 10),
    issuer: fiscal.issuer,
    customer: o.billing ?? null,
    lines,
    taxName: fiscal.taxName,
    ...t,
    currency: pay.currency,
  });
  return { invoice: inv, created: true };
}

/**
 * Factura del pedido y, si ya hubo devoluciones (p.ej. se factura tarde, al completar
 * los datos fiscales), sus rectificativas: la venta y la devolución quedan reflejadas
 * por separado, como manda la norma.
 */
export async function issueOrderWithRefundsTx(tx: Tx, tenantId: string, orderId: string) {
  const r = await issueForOrderTx(tx, tenantId, orderId);
  const rectifications: InvoiceRow[] = [];
  if ("skipped" in r) return { result: r, rectifications };
  const refunds = await tx
    .select({ id: schema.refund.id })
    .from(schema.refund)
    .where(and(eq(schema.refund.orderId, orderId), eq(schema.refund.status, "SUCCEEDED")))
    .orderBy(asc(schema.refund.createdAt));
  for (const f of refunds) {
    const x = await issueRectificationTx(tx, tenantId, f.id);
    if ("invoice" in x && x.created) rectifications.push(x.invoice);
  }
  return { result: r, rectifications };
}

/**
 * Canje: factura COMPLETA que sustituye a la simplificada de un pedido (tipo F3), cuando
 * el comprador pide factura a su nombre después de comprar.
 */
export async function issueReplacementTx(tx: Tx, tenantId: string, orderId: string, customer: BillingData) {
  const [simp] = await tx
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.orderId, orderId), eq(schema.invoice.kind, "SIMPLIFIED")));
  if (!simp) return { skipped: "El pedido no tiene factura simplificada" } as const;
  const [done] = await tx
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.orderId, orderId), eq(schema.invoice.kind, "FULL")));
  if (done) return { invoice: done, created: false } as const;
  const fiscal = await tenantIssuerTx(tx, tenantId);
  if (!fiscal) return { skipped: "Faltan los datos fiscales del promotor" } as const;
  const inv = await insertInvoiceTx(tx, tenantId, {
    orderId,
    kind: "FULL",
    aeatType: "F3",
    operationDate: simp.operationDate,
    replacesId: simp.id,
    issuer: fiscal.issuer,
    customer,
    lines: simp.lines,
    taxes: simp.taxes,
    taxName: simp.taxName,
    baseCents: simp.baseCents,
    taxCents: simp.taxCents,
    totalCents: simp.totalCents,
    currency: simp.currency,
  });
  return { invoice: inv, created: true } as const;
}

/**
 * Rectificativa (por diferencias, importes negativos) de una devolución hecha. Rectifica
 * la factura vigente del pedido (la completa si hubo canje). Si el pedido nunca se
 * facturó (venta anterior a la facturación), no hay nada que rectificar.
 */
export async function issueRectificationTx(tx: Tx, tenantId: string, refundId: string): Promise<IssueResult> {
  const [done] = await tx.select().from(schema.invoice).where(eq(schema.invoice.refundId, refundId));
  if (done) return { invoice: done, created: false };
  const [r] = await tx.select().from(schema.refund).where(eq(schema.refund.id, refundId));
  if (!r || r.status !== "SUCCEEDED") return { skipped: "Devolución no completada" };
  const originals = await tx
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.orderId, r.orderId), sql`${schema.invoice.kind} <> 'RECTIFYING'`))
    .orderBy(desc(schema.invoice.createdAt));
  const original = originals.find((i) => i.kind === "FULL") ?? originals[0];
  if (!original) return { skipped: "El pedido no tiene factura" };
  const fiscal = await tenantIssuerTx(tx, tenantId);
  if (!fiscal) return { skipped: "Faltan los datos fiscales del promotor" };

  // Qué se devuelve: las líneas de las entradas devueltas (todas si la devolución es
  // del pedido entero), y el importe se reparte en proporción a lo que costaron.
  const refunded = new Set(r.ticketIds);
  const affected = original.lines
    .map((l) => {
      const ids = refunded.size ? l.ticketIds.filter((id) => refunded.has(id)) : l.ticketIds;
      return { line: l, ids, gross: l.unitCents * ids.length };
    })
    .filter((a) => a.ids.length > 0 && a.gross > 0);
  const pool = affected.reduce((a, x) => a + x.gross, 0);
  if (!pool) return { skipped: "Las entradas devueltas no están en la factura" };

  let left = r.amountCents;
  const lines: InvoiceLine[] = affected.map((a, i) => {
    const part = i === affected.length - 1 ? left : Math.round((r.amountCents * a.gross) / pool);
    left -= part;
    const { baseCents, taxCents } = splitGross(part, a.line.rateBp);
    return {
      description: `Devolución: ${a.line.description}`,
      quantity: -a.ids.length,
      unitCents: a.ids.length ? Math.round(part / a.ids.length) : part,
      totalCents: -part,
      rateBp: a.line.rateBp,
      baseCents: -baseCents,
      taxCents: -taxCents,
      exemptReason: a.line.exemptReason ?? null,
      ticketIds: a.ids,
    };
  });
  const inv = await insertInvoiceTx(tx, tenantId, {
    orderId: r.orderId,
    kind: "RECTIFYING",
    aeatType: original.kind === "SIMPLIFIED" ? "R5" : "R1",
    rectifiesId: original.id,
    refundId,
    issuer: fiscal.issuer,
    customer: original.customer,
    lines,
    taxName: original.taxName,
    ...totals(lines),
    currency: original.currency,
  });
  return { invoice: inv, created: true };
}
