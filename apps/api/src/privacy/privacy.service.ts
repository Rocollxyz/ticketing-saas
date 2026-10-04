import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import { schema } from "@ticketing/database";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { seatLabel } from "../catalog/seat-label";
import * as input from "../common/input";
import { AdminDb } from "../database/admin-db.service";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

const HOUR = 3_600_000;

/**
 * RGPD (SECURITY_AUDIT H4). El promotor es el responsable de los datos de sus
 * compradores y asistentes; la plataforma, la encargada. Aquí:
 *  - derechos de ACCESO y SUPRESIÓN (consola): buscar a una persona por email,
 *    exportar sus datos y suprimirlos;
 *  - CONSERVACIÓN limitada (tarea programada): datos de asistentes de reservas no
 *    pagadas a las 24 h y los de las entradas, `attendee_retention_days` tras el evento.
 * Las facturas NO se tocan: son obligación legal (y además inalterables).
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly admin: AdminDb,
  ) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") throw new ForbiddenException("Solo el promotor gestiona los datos personales");
  }

  private emailOf(v: unknown) {
    const e = input.email(v, "Email");
    if (!e) throw new BadRequestException("Indica un email");
    return e;
  }

  /** Pedidos donde aparece el email: como comprador o en los datos de algún asistente. */
  private async ordersTx(tx: Tx, email: string) {
    const like = `%${email.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const byTicket = tx
      .select({ id: schema.ticket.orderId })
      .from(schema.ticket)
      .where(sql`${schema.ticket.attendee}::text ilike ${like}`);
    return tx
      .select({
        id: schema.order.id,
        status: schema.order.status,
        createdAt: schema.order.createdAt,
        buyerEmail: schema.order.buyerEmail,
        buyerName: schema.order.buyerName,
        billing: schema.order.billing,
        anonymizedAt: schema.order.anonymizedAt,
        eventId: schema.event.id,
        eventName: schema.event.name,
        eventStartsAt: schema.event.startsAt,
      })
      .from(schema.order)
      .innerJoin(schema.event, eq(schema.event.id, schema.order.eventId))
      .where(or(sql`lower(${schema.order.buyerEmail}) = ${email}`, inArray(schema.order.id, byTicket)))
      .orderBy(desc(schema.order.createdAt));
  }

  /** Derecho de acceso: todo lo que guardamos de esa persona. */
  search(rawEmail: unknown) {
    this.assertPromoter();
    const email = this.emailOf(rawEmail);
    return this.db.run(async (tx) => {
      const orders = await this.ordersTx(tx, email);
      const tickets = orders.length
        ? await tx
            .select({
              id: schema.ticket.id,
              orderId: schema.ticket.orderId,
              status: schema.ticket.status,
              attendee: schema.ticket.attendee,
              fila: schema.seat.fila,
              numero: schema.seat.numero,
              isGeneral: schema.seat.isGeneral,
              categoria: schema.ticketType.name,
            })
            .from(schema.ticket)
            .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
            .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
            .where(inArray(schema.ticket.orderId, orders.map((o) => o.id)))
        : [];
      const invoices = orders.length
        ? await tx
            .select({ orderId: schema.invoice.orderId, fullNumber: schema.invoice.fullNumber, customer: schema.invoice.customer })
            .from(schema.invoice)
            .where(inArray(schema.invoice.orderId, orders.map((o) => o.id)))
        : [];
      return {
        email,
        generatedAt: new Date().toISOString(),
        orders: orders.map((o) => ({
          ...o,
          tickets: tickets
            .filter((t) => t.orderId === o.id)
            .map(({ orderId: _o, fila, numero, isGeneral, categoria, ...t }) => ({
              ...t,
              seat: seatLabel({ fila, numero, isGeneral, categoria }),
              attendee: t.attendee ?? [],
            })),
          // Las facturas se conservan por obligación legal aunque se supriman los datos.
          invoices: invoices.filter((i) => i.orderId === o.id).map(({ orderId: _o, ...i }) => i),
        })),
      };
    });
  }

  /**
   * Derecho de supresión: borra los datos personales de esa persona en los pedidos y
   * entradas (comprador, facturación, datos de asistentes). Se conservan el pedido y
   * las facturas (contabilidad). Queda constancia sin guardar el email en claro.
   */
  erase(rawEmail: unknown) {
    this.assertPromoter();
    const email = this.emailOf(rawEmail);
    const store = getStore()!;
    return this.db.run(async (tx) => {
      const orders = await this.ordersTx(tx, email);
      const ids = orders.map((o) => o.id);
      if (!ids.length) return { orders: 0, tickets: 0 };
      await tx
        .update(schema.order)
        .set({ buyerEmail: null, buyerName: null, billing: null, anonymizedAt: new Date(), updatedAt: new Date() })
        .where(inArray(schema.order.id, ids));
      const tk = await tx
        .update(schema.ticket)
        .set({ attendee: null, attendeeName: null, updatedAt: new Date() })
        .where(inArray(schema.ticket.orderId, ids))
        .returning({ id: schema.ticket.id });
      await tx
        .update(schema.holdSeat)
        .set({ attendee: null })
        .where(
          inArray(
            schema.holdSeat.holdId,
            tx.select({ id: schema.hold.id }).from(schema.hold).where(inArray(schema.hold.orderId, ids)),
          ),
        );
      await tx.insert(schema.auditLog).values({
        tenantId: store.tenantId,
        actorUserId: store.userId,
        action: "privacy.erased",
        // Sin el email en claro: solo su huella, para poder acreditar que se atendió.
        diff: { emailSha256: createHash("sha256").update(email).digest("hex"), orders: ids.length, tickets: tk.length },
      });
      return { orders: ids.length, tickets: tk.length };
    });
  }

  /** Conservación limitada. Cada hora; trabajo de sistema (todos los promotores). */
  @Interval("privacy-retention", HOUR)
  async purge() {
    try {
      // Reservas no pagadas (o ya convertidas en entrada): el formulario de asistentes
      // vive 24 h en la plaza reservada; la entrada tiene su propia copia.
      const holds = await this.admin.db.execute(sql`
        update hold_seat hs set attendee = null
        from hold h
        where h.id = hs.hold_id and hs.attendee is not null and h.expires_at < now() - interval '1 day'`);
      // Entradas de eventos pasados: fuera los datos de asistentes al acabar el plazo.
      const tickets = await this.admin.db.execute(sql`
        update ticket t set attendee = null, attendee_name = null, updated_at = now()
        from event e join tenant tn on tn.id = e.tenant_id
        where e.id = t.event_id and (t.attendee is not null or t.attendee_name is not null)
          and coalesce(e.ends_at, e.starts_at) < now() - make_interval(days => tn.attendee_retention_days)`);
      const n = (r: unknown) => (r as { count?: number }).count ?? 0;
      if (n(holds) || n(tickets)) {
        this.logger.log(`RGPD: datos de asistentes borrados en ${n(holds)} reserva(s) y ${n(tickets)} entrada(s)`);
      }
    } catch (e) {
      this.logger.error(`RGPD: la limpieza falló: ${e instanceof Error ? e.message : e}`);
    }
  }
}
