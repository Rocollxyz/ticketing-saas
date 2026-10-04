import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { eq, inArray } from "drizzle-orm";
import { type IssueResult, issueOrderWithRefundsTx, issueRectificationTx } from "../billing/invoice-issuer";
import { InvoicePdfService } from "../billing/invoice-pdf.service";
import { AdminDb } from "../database/admin-db.service";
import { EMAIL_PROVIDER, type EmailProvider } from "./email-provider";

const euros = (c: number) => (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/**
 * Trabajos de facturación del outbox: `invoice.issue` (pedido cobrado) e
 * `invoice.rectify` (devolución hecha). Emiten la factura (idempotente) y la envían al
 * comprador en PDF. Sin datos fiscales del promotor no se emite: queda como pendiente
 * y el promotor la emite desde la consola al completarlos.
 */
@Injectable()
export class InvoiceJobsService {
  private readonly logger = new Logger(InvoiceJobsService.name);

  constructor(
    private readonly admin: AdminDb,
    private readonly pdf: InvoicePdfService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async issue(tenantId: string | null, orderId: string) {
    const tid = tenantId ?? (await this.tenantOf(orderId));
    const { result, rectifications } = await this.admin.db.transaction((tx) =>
      issueOrderWithRefundsTx(tx, tid, orderId),
    );
    await this.after(result, orderId);
    for (const inv of rectifications) await this.after({ invoice: inv, created: true }, orderId);
  }

  async rectify(tenantId: string | null, refundId: string) {
    const [ref] = await this.admin.db.select().from(schema.refund).where(eq(schema.refund.id, refundId));
    if (!ref) return;
    const r = await this.admin.db.transaction((tx) =>
      issueRectificationTx(tx, tenantId ?? ref.tenantId, refundId),
    );
    await this.after(r, ref.orderId);
  }

  private async tenantOf(orderId: string) {
    const [o] = await this.admin.db.select({ t: schema.order.tenantId }).from(schema.order).where(eq(schema.order.id, orderId));
    if (!o) throw new Error(`pedido ${orderId} no encontrado`);
    return o.t;
  }

  /** Envía la factura recién emitida al comprador. Un fallo de email no deshace la factura. */
  private async after(r: IssueResult, orderId: string) {
    if ("skipped" in r) {
      this.logger.log(`pedido ${orderId}: sin factura (${r.skipped})`);
      return;
    }
    if (!r.created) return;
    const inv = r.invoice;
    try {
      const [o] = await this.admin.db
        .select({ to: schema.order.buyerEmail, name: schema.order.buyerName, event: schema.event.name })
        .from(schema.order)
        .innerJoin(schema.event, eq(schema.event.id, schema.order.eventId))
        .where(eq(schema.order.id, orderId));
      if (!o?.to) return;
      const ids = [inv.rectifiesId, inv.replacesId].filter((x): x is string => !!x);
      const others = ids.length
        ? await this.admin.db
            .select({ id: schema.invoice.id, n: schema.invoice.fullNumber })
            .from(schema.invoice)
            .where(inArray(schema.invoice.id, ids))
        : [];
      const num = (x: string | null) => others.find((e) => e.id === x)?.n ?? null;
      const content = await this.pdf.render(inv, { rectifies: num(inv.rectifiesId), replaces: num(inv.replacesId) });
      const rect = inv.kind === "RECTIFYING";
      await this.email.send({
        to: o.to,
        subject: `${rect ? "Factura rectificativa" : "Tu factura"} ${inv.fullNumber} — ${o.event}`,
        text:
          `${o.name ? `Hola ${o.name},\n\n` : ""}` +
          (rect
            ? `Adjuntamos la factura rectificativa ${inv.fullNumber} por la devolución de ${euros(-inv.totalCents)}.\n`
            : `Adjuntamos la factura ${inv.fullNumber} de tu compra para ${o.event} (${euros(inv.totalCents)}).\n`) +
          `\nEmitida por ${inv.issuer.name} (NIF ${inv.issuer.taxId}).\n`,
        attachments: [{ filename: `${inv.fullNumber}.pdf`, content, contentType: "application/pdf" }],
      });
    } catch (e) {
      this.logger.error(`factura ${inv.fullNumber} emitida pero no enviada: ${e instanceof Error ? e.message : e}`);
    }
  }
}
