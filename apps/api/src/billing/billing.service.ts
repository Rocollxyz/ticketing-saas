import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { type BillingData, schema } from "@ticketing/database";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { qualified } from "../catalog/pricing";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { issueOrderWithRefundsTx, issueRectificationTx, issueReplacementTx } from "./invoice-issuer";
import { InvoicePdfService } from "./invoice-pdf.service";
import { formatRate, isValidSpanishTaxId, normalizeTaxId, SIMPLIFIED_LIMIT_CENTS } from "./tax";

const KIND_LABEL: Record<string, string> = {
  F1: "Completa",
  F2: "Simplificada",
  F3: "Completa (canje)",
  R1: "Rectificativa",
  R5: "Rectificativa simplificada",
};

/** Pedidos cobrados (importe > 0) que aún no tienen factura. */
const pendingWhere = sql`${schema.order.status} = 'PAID'
  and exists (select 1 from payment p where p.order_id = ${qualified(schema.order.id)}
              and p.status in ('CAPTURED','REFUNDED') and p.amount_cents > 0 and p.provider_ref <> 'INVITACION')
  and not exists (select 1 from invoice i where i.order_id = ${qualified(schema.order.id)} and i.kind <> 'RECTIFYING')`;

/** Datos fiscales de un destinatario (factura completa), validados. */
export function parseBilling(b: unknown): BillingData {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const taxId = normalizeTaxId(input.text(o.taxId, "NIF", 20, true)!);
  if (!isValidSpanishTaxId(taxId) && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(taxId)) {
    throw new BadRequestException("NIF no válido (DNI, NIE, CIF o NIF-IVA europeo)");
  }
  return {
    name: input.text(o.name, "Nombre o razón social", 200, true)!,
    taxId,
    address: input.text(o.address, "Dirección", 300, true)!,
    postalCode: input.text(o.postalCode, "Código postal", 10, true)!,
    city: input.text(o.city, "Población", 100, true)!,
    country: input.text(o.country, "País", 60) ?? undefined,
  };
}

/**
 * Facturación del promotor en la consola: facturas emitidas, PDF, libro registro de
 * facturas expedidas (CSV para la gestoría), emisión de las pendientes y canje de una
 * simplificada por una completa. Solo el promotor.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: TenantDb,
    private readonly pdf: InvoicePdfService,
  ) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") throw new ForbiddenException("Solo el promotor ve la facturación");
  }

  private range(q: { from?: string; to?: string }) {
    const from = input.date(q.from || undefined, "Desde") ?? null;
    const to = input.date(q.to || undefined, "Hasta") ?? null;
    return [
      ...(from ? [gte(schema.invoice.issuedAt, from)] : []),
      ...(to ? [lt(schema.invoice.issuedAt, to)] : []),
    ];
  }

  list(q: { from?: string; to?: string }) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          id: schema.invoice.id,
          fullNumber: schema.invoice.fullNumber,
          kind: schema.invoice.kind,
          aeatType: schema.invoice.aeatType,
          issuedAt: schema.invoice.issuedAt,
          orderId: schema.invoice.orderId,
          customer: schema.invoice.customer,
          taxName: schema.invoice.taxName,
          baseCents: schema.invoice.baseCents,
          taxCents: schema.invoice.taxCents,
          totalCents: schema.invoice.totalCents,
          rectifiesId: schema.invoice.rectifiesId,
          buyerEmail: schema.order.buyerEmail,
          buyerName: schema.order.buyerName,
          eventName: schema.event.name,
          // Simplificada que ya se canjeó por una completa.
          replaced: sql<boolean>`exists (select 1 from invoice r where r.replaces_id = ${schema.invoice.id})`,
        })
        .from(schema.invoice)
        .innerJoin(schema.order, eq(schema.order.id, schema.invoice.orderId))
        .innerJoin(schema.event, eq(schema.event.id, schema.order.eventId))
        .where(and(...this.range(q)))
        .orderBy(desc(schema.invoice.issuedAt))
        .limit(500);
      const [{ pending }] = await tx
        .select({ pending: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.order)
        .where(pendingWhere);
      const [{ loose }] = await tx
        .select({ loose: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.refund)
        .where(
          sql`${schema.refund.status} = 'SUCCEEDED'
            and not exists (select 1 from invoice i where i.refund_id = ${qualified(schema.refund.id)})
            and exists (select 1 from invoice i where i.order_id = ${qualified(schema.refund.orderId)} and i.kind <> 'RECTIFYING')`,
        );
      const [t] = await tx.select().from(schema.tenant).where(eq(schema.tenant.id, getStore()!.tenantId));
      return {
        fiscalReady: !!(t?.taxId && t.fiscalName && t.fiscalAddress && t.fiscalPostalCode && t.fiscalCity),
        pendingOrders: pending,
        pendingRectifications: loose,
        invoices: rows.map((r) => ({
          ...r,
          kindLabel: KIND_LABEL[r.aeatType] ?? r.aeatType,
          // Más de 400 € en simplificada: la ley pide completa → hay que canjearla.
          needsFull: r.kind === "SIMPLIFIED" && !r.replaced && r.totalCents > SIMPLIFIED_LIMIT_CENTS,
        })),
      };
    });
  }

  async pdfFile(id: string) {
    this.assertPromoter();
    const { inv, refs } = await this.db.run(async (tx) => {
      const [inv] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, id));
      if (!inv) throw new NotFoundException("Factura no encontrada");
      const ids = [inv.rectifiesId, inv.replacesId].filter((x): x is string => !!x);
      const others = ids.length
        ? await tx
            .select({ id: schema.invoice.id, n: schema.invoice.fullNumber })
            .from(schema.invoice)
            .where(inArray(schema.invoice.id, ids))
        : [];
      const num = (x: string | null) => others.find((o) => o.id === x)?.n ?? null;
      return { inv, refs: { rectifies: num(inv.rectifiesId), replaces: num(inv.replacesId) } };
    });
    return { filename: `${inv.fullNumber}.pdf`, body: await this.pdf.render(inv, refs) };
  }

  /**
   * Libro registro de facturas expedidas: una fila por factura y tipo impositivo, con
   * las columnas que pide la gestoría para el modelo 303 y el libro de IVA.
   */
  exportCsv(q: { from?: string; to?: string }) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.invoice)
        .where(and(...this.range(q)))
        .orderBy(schema.invoice.series, schema.invoice.number);
      const byId = new Map(rows.map((r) => [r.id, r.fullNumber]));
      const missing = rows.filter((r) => r.rectifiesId && !byId.has(r.rectifiesId)).map((r) => r.rectifiesId!);
      if (missing.length) {
        const extra = await tx
          .select({ id: schema.invoice.id, n: schema.invoice.fullNumber })
          .from(schema.invoice)
          .where(inArray(schema.invoice.id, missing));
        for (const e of extra) byId.set(e.id, e.n);
      }
      const date = (d: Date | string) =>
        new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid" }).format(new Date(d));
      const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
      const header = [
        "Fecha expedición",
        "Fecha operación",
        "Serie",
        "Número",
        "Factura",
        "Tipo de factura",
        "NIF destinatario",
        "Nombre destinatario",
        "Base imponible",
        "Tipo impositivo",
        "Cuota",
        "Total factura",
        "Exención",
        "Factura rectificada",
      ];
      const lines: string[][] = [];
      for (const r of rows) {
        for (const t of r.taxes) {
          lines.push([
            date(r.issuedAt),
            r.operationDate ? date(r.operationDate) : "",
            r.series,
            String(r.number),
            r.fullNumber,
            `${r.aeatType} ${KIND_LABEL[r.aeatType] ?? ""}`.trim(),
            r.customer?.taxId ?? "",
            r.customer?.name ?? "",
            money(t.baseCents),
            `${r.taxName} ${formatRate(t.rateBp)}`,
            money(t.taxCents),
            money(r.totalCents),
            t.exemptReason ?? "",
            r.rectifiesId ? (byId.get(r.rectifiesId) ?? "") : "",
          ]);
        }
      }
      const cell = (v: string) => {
        const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
        return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const csv = [header, ...lines].map((l) => l.map(cell).join(";")).join("\r\n");
      return { filename: "libro-facturas-expedidas.csv", body: `﻿${csv}\r\n` };
    });
  }

  /** Emite las facturas de los pedidos cobrados que no tienen (p.ej. antes de dar los datos fiscales). */
  async issuePending() {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    const orders = await this.db.run((tx) =>
      tx
        .select({ id: schema.order.id })
        .from(schema.order)
        .where(pendingWhere)
        .orderBy(schema.order.createdAt)
        .limit(500),
    );
    let issued = 0;
    let skipped: string | null = null;
    let rectifications = 0;
    for (const o of orders) {
      const { result, rectifications: rs } = await this.db.run((tx) => issueOrderWithRefundsTx(tx, tenantId, o.id));
      if ("skipped" in result) skipped = result.skipped;
      else if (result.created) issued++;
      rectifications += rs.length;
    }
    // Devoluciones hechas de pedidos ya facturados que aún no tienen su rectificativa.
    const loose = await this.db.run((tx) =>
      tx
        .select({ id: schema.refund.id })
        .from(schema.refund)
        .where(
          sql`${schema.refund.status} = 'SUCCEEDED'
            and not exists (select 1 from invoice i where i.refund_id = ${qualified(schema.refund.id)})
            and exists (select 1 from invoice i where i.order_id = ${qualified(schema.refund.orderId)} and i.kind <> 'RECTIFYING')`,
        )
        .orderBy(schema.refund.createdAt),
    );
    for (const f of loose) {
      const r = await this.db.run((tx) => issueRectificationTx(tx, tenantId, f.id));
      if ("invoice" in r && r.created) rectifications++;
    }
    return { issued, rectifications, skipped, remaining: orders.length - issued };
  }

  /** Canje: completa a nombre del comprador en sustitución de la simplificada. */
  async replace(invoiceId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const customer = parseBilling(body.customer);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const [inv] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
      if (!inv) throw new NotFoundException("Factura no encontrada");
      if (inv.kind !== "SIMPLIFIED") throw new BadRequestException("Solo se canjea una factura simplificada");
      const r = await issueReplacementTx(tx, tenantId, inv.orderId, customer);
      if ("skipped" in r) throw new BadRequestException(r.skipped);
      return { id: r.invoice.id, fullNumber: r.invoice.fullNumber };
    });
  }
}
