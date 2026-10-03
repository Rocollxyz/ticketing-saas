import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { signTicketQr } from "@ticketing/crypto";
import { schema } from "@ticketing/database";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { formatInZone } from "../catalog/format";
import { currentPriceCents } from "../catalog/pricing";
import { seatLabel } from "../catalog/seat-label";
import { AdminDb } from "../database/admin-db.service";
import { EMAIL_PROVIDER, type EmailAttachment, type EmailProvider } from "./email-provider";
import { TicketPdfService } from "./ticket-pdf.service";

const POLL_MS = 5_000;
const BATCH = 20;

interface TicketIssuedPayload {
  orderId: string;
  ticketIds: string[];
}

/**
 * Worker del transactional outbox (§5). El motor de reserva escribe efectos externos
 * (`ticket.issued`) en la MISMA transacción que la emisión; este worker los procesa
 * después: genera el PDF de cada entrada con su QR y lo entrega por email. Evita el
 * "cobrado pero sin entrada".
 *
 * Multi-tenant y fuera de RLS por diseño (igual que el sweeper): usa AdminDb. La
 * entrega es AT-LEAST-ONCE — si el proceso muere tras enviar pero antes de marcar
 * `processed_at`, se reintenta (posible duplicado en dev; aceptable). Las filas con
 * tipo desconocido se marcan procesadas para no atascar la cola.
 */
@Injectable()
export class OutboxWorkerService {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private running = false;

  constructor(
    private readonly admin: AdminDb,
    private readonly pdf: TicketPdfService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  @Interval("outbox-worker", POLL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.admin.db
        .select()
        .from(schema.outbox)
        .where(isNull(schema.outbox.processedAt))
        .orderBy(schema.outbox.createdAt)
        .limit(BATCH);

      for (const row of pending) {
        try {
          if (row.type === "ticket.issued") {
            await this.handleTicketIssued(row.tenantId, row.payload as TicketIssuedPayload);
          } else {
            this.logger.warn(`tipo de outbox desconocido: ${row.type} (id ${row.id}) — se omite`);
          }
          await this.admin.db
            .update(schema.outbox)
            .set({ processedAt: new Date() })
            .where(eq(schema.outbox.id, row.id));
        } catch (e) {
          this.logger.error(
            `outbox ${row.id} (${row.type}) falló: ${e instanceof Error ? e.message : e}; se reintentará`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async handleTicketIssued(tenantId: string | null, payload: TicketIssuedPayload) {
    const { orderId } = payload;

    const [order] = await this.admin.db
      .select({
        buyerEmail: schema.order.buyerEmail,
        buyerName: schema.order.buyerName,
        eventId: schema.order.eventId,
      })
      .from(schema.order)
      .where(
        and(eq(schema.order.id, orderId), ...(tenantId ? [eq(schema.order.tenantId, tenantId)] : [])),
      );
    if (!order) throw new Error(`pedido ${orderId} no encontrado`);

    const [ev] = await this.admin.db
      .select({
        name: schema.event.name,
        startsAt: schema.event.startsAt,
        doorsAt: schema.event.doorsAt,
        timezone: schema.event.timezone,
        confirmationMessage: schema.event.confirmationMessage,
        contactEmail: schema.event.contactEmail,
        venueName: schema.venue.name,
        venueAddress: schema.venue.address,
        venueCity: schema.venue.city,
      })
      .from(schema.event)
      .leftJoin(schema.venue, eq(schema.venue.id, schema.event.venueId))
      .where(eq(schema.event.id, order.eventId));
    const when = ev?.startsAt ? formatInZone(ev.startsAt, ev.timezone) : null;
    const doors = ev?.doorsAt ? formatInZone(ev.doorsAt, ev.timezone, true) : null;
    const where = [ev?.venueName, ev?.venueAddress, ev?.venueCity].filter(Boolean).join(", ") || null;

    const [key] = await this.admin.db
      .select({ k: schema.eventSigningKey.encryptedKey })
      .from(schema.eventSigningKey)
      .where(eq(schema.eventSigningKey.eventId, order.eventId));
    if (!key) throw new Error(`evento ${order.eventId} sin clave de firma`);

    const tickets = await this.admin.db
      .select({
        id: schema.ticket.id,
        fila: schema.seat.fila,
        numero: schema.seat.numero,
        isGeneral: schema.seat.isGeneral,
        categoria: schema.ticketType.name,
        precio: currentPriceCents(schema.ticketType.id),
      })
      .from(schema.ticket)
      .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
      .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
      .where(
        and(
          eq(schema.ticket.orderId, orderId),
          ...(payload.ticketIds?.length ? [inArray(schema.ticket.id, payload.ticketIds)] : []),
        ),
      );

    const euros = (c: number | null) =>
      c == null ? null : (Number(c) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

    const attachments: EmailAttachment[] = [];
    for (const t of tickets) {
      const qr = signTicketQr({ t: t.id, e: order.eventId }, key.k);
      const label = seatLabel(t);
      const content = await this.pdf.render({
        ticketId: t.id,
        eventName: ev?.name ?? "Evento",
        when,
        doors,
        where,
        seatLabel: t.isGeneral ? null : label,
        categoria: t.categoria,
        precio: euros(t.precio),
        qr,
      });
      const file = t.isGeneral ? `${label}-${t.id.slice(0, 8)}` : label;
      attachments.push({
        filename: `entrada-${file.replace(/[^\p{L}\p{N}-]+/gu, "_")}.pdf`,
        content,
        contentType: "application/pdf",
      });
    }

    const to = order.buyerEmail ?? process.env.DEV_FALLBACK_EMAIL ?? "comprador@demo.test";
    await this.email.send({
      to,
      subject: `Tus entradas — ${ev?.name ?? "Evento"}`,
      text:
        `${order.buyerName ? `Hola ${order.buyerName},\n\n` : ""}` +
        `Adjuntamos ${attachments.length} entrada(s) para ${ev?.name ?? "el evento"}. ` +
        `Cada PDF lleva un código QR que se validará en el acceso.\n\n` +
        (when ? `Cuándo: ${when}${doors ? ` (puertas: ${doors})` : ""}\n` : "") +
        (where ? `Dónde: ${where}\n` : "") +
        (ev?.confirmationMessage ? `\n${ev.confirmationMessage}\n` : "") +
        (ev?.contactEmail ? `\n¿Dudas? Escribe a ${ev.contactEmail}\n` : "") +
        `\nGracias por tu compra.`,
      attachments,
    });
  }
}
