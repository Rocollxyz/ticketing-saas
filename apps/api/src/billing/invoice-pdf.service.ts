import { Injectable } from "@nestjs/common";
import type { schema } from "@ticketing/database";
import PDFDocument from "pdfkit";
import { formatRate } from "./tax";

type InvoiceRow = typeof schema.invoice.$inferSelect;

const money = (c: number) => (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const day = (d: Date | string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long" }).format(new Date(d));

const TITLE: Record<string, string> = {
  F1: "Factura",
  F2: "Factura simplificada",
  F3: "Factura (en sustitución de factura simplificada)",
  R1: "Factura rectificativa",
  R5: "Factura simplificada rectificativa",
};

function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * PDF de una factura (A4) con el contenido de los arts. 6 y 7 del Reglamento de
 * facturación (RD 1619/2012): número y serie, fechas, emisor, destinatario (completas),
 * descripción, base, tipo y cuota por tipo, total y, si procede, la mención de exención
 * o la factura que se rectifica.
 */
@Injectable()
export class InvoicePdfService {
  async render(inv: InvoiceRow, refs: { rectifies?: string | null; replaces?: string | null } = {}): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const out = streamToBuffer(doc);
    const W = doc.page.width - 100;

    doc.fontSize(18).fillColor("#111111").text(TITLE[inv.aeatType] ?? "Factura");
    doc.fontSize(11).fillColor("#333333").text(`Nº ${inv.fullNumber}`);
    doc.fontSize(9).fillColor("#555555").text(`Fecha de expedición: ${day(inv.issuedAt)}`);
    if (inv.operationDate && inv.operationDate !== new Date(inv.issuedAt).toISOString().slice(0, 10)) {
      doc.text(`Fecha de la operación: ${day(inv.operationDate)}`);
    }
    if (refs.rectifies) {
      doc.text(`Rectifica la factura ${refs.rectifies} por devolución (art. 80.Dos de la Ley del IVA).`);
    }
    if (refs.replaces) doc.text(`Sustituye a la factura simplificada ${refs.replaces}.`);

    // Emisor y destinatario, en dos columnas.
    const top = doc.y + 14;
    const col = (x: number, title: string, rows: (string | null | undefined)[]) => {
      doc.fontSize(8).fillColor("#888888").text(title.toUpperCase(), x, top, { width: W / 2 - 10 });
      doc.fontSize(10).fillColor("#111111");
      for (const r of rows.filter(Boolean)) doc.text(r!, x, doc.y, { width: W / 2 - 10 });
      return doc.y;
    };
    const i = inv.issuer;
    const yA = col(50, "Emisor", [
      i.name,
      `NIF ${i.taxId}`,
      i.address,
      `${i.postalCode} ${i.city}${i.province ? ` (${i.province})` : ""}`,
    ]);
    const c = inv.customer;
    const yB = c
      ? col(50 + W / 2, "Destinatario", [c.name, `NIF ${c.taxId}`, c.address, `${c.postalCode} ${c.city}`, c.country])
      : top;
    doc.y = Math.max(yA, yB) + 20;

    // Líneas.
    const cols = [
      { t: "Concepto", w: W - 250, a: "left" as const },
      { t: "Uds.", w: 40, a: "right" as const },
      { t: "Precio", w: 70, a: "right" as const },
      { t: inv.taxName, w: 50, a: "right" as const },
      { t: "Importe", w: 90, a: "right" as const },
    ];
    const row = (cells: string[], opts: { bold?: boolean; color?: string } = {}) => {
      const y = doc.y;
      let x = 50;
      let h = 0;
      doc.fontSize(9).fillColor(opts.color ?? "#111111").font(opts.bold ? "Helvetica-Bold" : "Helvetica");
      cells.forEach((cell, k) => {
        doc.text(cell, x, y, { width: cols[k].w, align: cols[k].a });
        h = Math.max(h, doc.y - y);
        x += cols[k].w;
      });
      doc.y = y + h + 4;
      doc.font("Helvetica");
    };
    row(cols.map((c) => c.t), { bold: true, color: "#555555" });
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor("#dddddd").stroke();
    doc.y += 4;
    for (const l of inv.lines) {
      row([l.description, String(l.quantity), money(l.unitCents), formatRate(l.rateBp), money(l.totalCents)]);
    }
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor("#dddddd").stroke();
    doc.y += 10;

    // Desglose por tipo y totales.
    const right = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.fontSize(bold ? 11 : 9).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor("#111111");
      doc.text(label, 50, y, { width: W - 100, align: "right" });
      doc.text(value, 50 + W - 100, y, { width: 100, align: "right" });
      doc.font("Helvetica");
    };
    for (const t of inv.taxes) {
      right(`Base imponible al ${formatRate(t.rateBp)}`, money(t.baseCents));
      right(`Cuota ${inv.taxName} ${formatRate(t.rateBp)}`, money(t.taxCents));
    }
    doc.moveDown(0.3);
    right("Total", money(inv.totalCents), true);
    doc.moveDown(1);

    const exempt = inv.taxes.filter((t) => t.rateBp === 0 && t.exemptReason);
    doc.fontSize(8).fillColor("#555555");
    for (const t of exempt) doc.text(`Operación exenta: ${t.exemptReason}`, 50, doc.y, { width: W });
    if (!c) doc.text(`Precios con ${inv.taxName} incluido.`, 50, doc.y, { width: W });

    doc
      .fontSize(6)
      .fillColor("#aaaaaa")
      .text(`Registro ${inv.recordedAt} · huella ${inv.recordHash}`, 50, doc.page.height - 60, { width: W });
    doc.end();
    return out;
  }
}
