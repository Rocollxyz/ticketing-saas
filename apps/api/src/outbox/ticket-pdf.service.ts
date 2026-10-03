import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export interface TicketDoc {
  ticketId: string;
  eventName: string;
  /** Fecha/hora ya formateadas en la zona del evento. */
  when?: string | null;
  doors?: string | null;
  where?: string | null;
  /** null en entrada general (sin asiento): manda la categoría. */
  seatLabel: string | null;
  /** Titular (entradas nominativas). */
  attendeeName?: string | null;
  /** Otros datos del asistente que el promotor quiere impresos. */
  extra?: { label: string; value: string }[];
  categoria: string | null;
  precio: string | null;
  /** Token QR firmado (el mismo que validará la app de acceso en Fase 4). */
  qr: string;
}

function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Renderiza una entrada como PDF (tamaño A6) con el QR firmado en el centro. */
@Injectable()
export class TicketPdfService {
  async render(t: TicketDoc): Promise<Buffer> {
    const qrPng = await QRCode.toBuffer(t.qr, { margin: 1, width: 280 });

    const doc = new PDFDocument({ size: "A6", margin: 28 });
    const out = streamToBuffer(doc);

    doc.fontSize(16).fillColor("#111111").text(t.eventName, { align: "center" });
    if (t.when || t.where) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#444444");
      if (t.when) {
        doc.text(t.doors ? `${t.when} · puertas ${t.doors}` : t.when, { align: "center" });
      }
      if (t.where) doc.text(t.where, { align: "center" });
    }
    doc.moveDown(0.4);
    doc
      .fontSize(12)
      .fillColor("#333333")
      .text(t.seatLabel ? `Asiento ${t.seatLabel}` : "Entrada general", { align: "center" });
    if (t.attendeeName) {
      doc.fontSize(11).fillColor("#111111").text(t.attendeeName, { align: "center" });
    }
    for (const e of t.extra ?? []) {
      doc.fontSize(8).fillColor("#555555").text(`${e.label}: ${e.value}`, { align: "center" });
    }
    if (t.categoria || t.precio) {
      doc
        .fontSize(10)
        .fillColor("#666666")
        .text([t.categoria, t.precio].filter(Boolean).join(" · "), { align: "center" });
    }
    doc.moveDown(0.6);

    // El QR ocupa el espacio que quede (con muchos datos impresos, se reduce), sin
    // bajar de un tamaño que los lectores leen bien.
    const qrW = Math.max(110, Math.min(150, doc.page.height - doc.y - 60));
    const x = (doc.page.width - qrW) / 2;
    doc.image(qrPng, x, doc.y, { width: qrW });

    doc
      .fontSize(7)
      .fillColor("#999999")
      .text(`ID ${t.ticketId}`, 28, doc.page.height - 46, {
        align: "center",
        width: doc.page.width - 56,
      });

    doc.end();
    return out;
  }
}
