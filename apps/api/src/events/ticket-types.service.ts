import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, sql } from "drizzle-orm";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { seatHasHistory, syncGeneralSeats } from "./general-seats";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

/**
 * Tipos de entrada (categorías) de un evento: precio normal + precio anticipado
 * opcional, aforo (entrada general), ventana de venta propia y límites por pedido.
 *
 * Precios: se guardan como filas de `price` — la normal sin `valid_to` y la
 * anticipada con `valid_to` = fin de la anticipada. El precio vigente lo resuelve
 * `currentPriceCents` (gana la que caduca antes), así que el cambio de precio es
 * automático. Cambiar precios con el evento a la venta solo afecta a ventas futuras.
 */
@Injectable()
export class TicketTypesService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede gestionar las entradas");
    }
  }

  async create(eventId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const d = this.parse(body, true);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const ev = await this.editableEventTx(tx, eventId);
      if (ev.seatingMode === "GENERAL" && d.capacity == null) {
        throw new BadRequestException("Aforo: obligatorio en eventos de entrada general");
      }
      const [tt] = await tx
        .insert(schema.ticketType)
        .values({ ...d.fields, name: d.fields.name!, tenantId, eventId, capacity: d.capacity ?? null })
        .returning();
      await this.writePricesTx(tx, tenantId, tt.id, d.priceCents!, d.earlyBird ?? null);
      if (ev.seatingMode === "GENERAL") {
        await syncGeneralSeats(tx, tenantId, eventId, tt.id, d.capacity!);
      }
      return tt;
    });
  }

  async update(eventId: string, ticketTypeId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const d = this.parse(body, false);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const ev = await this.editableEventTx(tx, eventId);
      const tt = await this.loadTx(tx, eventId, ticketTypeId);
      const merged = { ...tt, ...d.fields };
      input.assertOrder(merged.salesStartAt, merged.salesEndAt, "El fin de venta debe ser posterior a su inicio");
      if (merged.maxPerOrder != null && merged.maxPerOrder < merged.minPerOrder) {
        throw new BadRequestException("El máximo por pedido no puede ser menor que el mínimo");
      }

      await tx
        .update(schema.ticketType)
        .set({
          ...d.fields,
          ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.ticketType.id, ticketTypeId));

      if (d.priceCents !== undefined || d.earlyBird !== undefined) {
        const current = await this.pricesOfTx(tx, ticketTypeId);
        await this.writePricesTx(
          tx,
          tenantId,
          ticketTypeId,
          d.priceCents ?? current.regular ?? 0,
          d.earlyBird !== undefined ? d.earlyBird : current.early,
        );
      }
      if (ev.seatingMode === "GENERAL" && d.capacity != null) {
        await syncGeneralSeats(tx, tenantId, eventId, ticketTypeId, d.capacity);
      }
      return { ok: true };
    });
  }

  /**
   * Borra la categoría si ninguna de sus plazas tiene historial. En entrada general se
   * borran sus plazas; en numerado los asientos quedan "sin categoría" en el plano.
   */
  async remove(eventId: string, ticketTypeId: string) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.editableEventTx(tx, eventId);
      await this.loadTx(tx, eventId, ticketTypeId);
      const [{ used }] = await tx
        .select({ used: sql<number>`count(*) filter (where ${seatHasHistory})`.mapWith(Number) })
        .from(schema.seat)
        .where(eq(schema.seat.ticketTypeId, ticketTypeId));
      if (used > 0) {
        throw new ConflictException("Esta categoría ya tiene ventas o reservas: no se puede eliminar");
      }
      await tx
        .delete(schema.seat)
        .where(and(eq(schema.seat.ticketTypeId, ticketTypeId), eq(schema.seat.isGeneral, true)));
      await tx
        .update(schema.seat)
        .set({ ticketTypeId: null })
        .where(eq(schema.seat.ticketTypeId, ticketTypeId));
      await tx.delete(schema.price).where(eq(schema.price.ticketTypeId, ticketTypeId));
      await tx.delete(schema.ticketType).where(eq(schema.ticketType.id, ticketTypeId));
      return { ok: true };
    });
  }

  private async writePricesTx(
    tx: Tx,
    tenantId: string,
    ticketTypeId: string,
    regular: number,
    early: { priceCents: number; until: Date } | null,
  ) {
    await tx.delete(schema.price).where(eq(schema.price.ticketTypeId, ticketTypeId));
    await tx.insert(schema.price).values([
      { tenantId, ticketTypeId, amountCents: BigInt(regular) },
      ...(early ? [{ tenantId, ticketTypeId, amountCents: BigInt(early.priceCents), validTo: early.until }] : []),
    ]);
  }

  private async pricesOfTx(tx: Tx, ticketTypeId: string) {
    const rows = await tx.select().from(schema.price).where(eq(schema.price.ticketTypeId, ticketTypeId));
    const regular = rows.find((p) => p.validTo == null);
    const early = rows.find((p) => p.validTo != null);
    return {
      regular: regular ? Number(regular.amountCents) : null,
      early: early ? { priceCents: Number(early.amountCents), until: early.validTo! } : null,
    };
  }

  private async editableEventTx(tx: Tx, eventId: string) {
    const [ev] = await tx.select().from(schema.event).where(eq(schema.event.id, eventId)).for("update");
    if (!ev) throw new NotFoundException("Evento no encontrado");
    if (ev.status === "CANCELLED") throw new ConflictException("Un evento cancelado no se puede editar");
    return ev;
  }

  private async loadTx(tx: Tx, eventId: string, ticketTypeId: string) {
    const [tt] = await tx
      .select()
      .from(schema.ticketType)
      .where(and(eq(schema.ticketType.id, ticketTypeId), eq(schema.ticketType.eventId, eventId)));
    if (!tt) throw new NotFoundException("Tipo de entrada no encontrado");
    return tt;
  }

  private parse(b: Record<string, unknown>, creating: boolean) {
    const fields = input.defined({
      name: input.text(b.name, "Nombre", 100, creating) ?? undefined,
      description: input.text(b.description, "Descripción", 1_000),
      salesStartAt: input.date(b.salesStartAt, "Inicio de venta"),
      salesEndAt: input.date(b.salesEndAt, "Fin de venta"),
      minPerOrder: input.int(b.minPerOrder, "Mínimo por pedido", 1, 100, false) ?? undefined,
      maxPerOrder: input.int(b.maxPerOrder, "Máximo por pedido", 1, 100),
      sortOrder: input.int(b.sortOrder, "Orden", 0, 10_000, false) ?? undefined,
      // Impuesto incluido en el precio, en centésimas de punto (1000 = 10 %).
      taxRateBp: input.int(b.taxRateBp, "Tipo de IVA", 0, 3_000, false) ?? undefined,
      taxExemptReason: input.text(b.taxExemptReason, "Motivo de la exención", 300),
    });
    if (fields.taxRateBp === 0 && !fields.taxExemptReason) {
      throw new BadRequestException("Entrada exenta: indica el motivo (p. ej. «Exenta, art. 20.Uno.14º Ley 37/1992»)");
    }
    if (fields.taxRateBp && fields.taxRateBp > 0) fields.taxExemptReason = null;
    if (creating) {
      input.assertOrder(fields.salesStartAt, fields.salesEndAt, "El fin de venta debe ser posterior a su inicio");
      if (fields.maxPerOrder != null && fields.maxPerOrder < (fields.minPerOrder ?? 1)) {
        throw new BadRequestException("El máximo por pedido no puede ser menor que el mínimo");
      }
    }

    // Precios en céntimos (0 = gratuita). Máximo 100.000 € por entrada.
    const priceCents = input.int(b.priceCents, "Precio", 0, 10_000_000, !creating);
    if (creating && priceCents == null) throw new BadRequestException("Precio: obligatorio");

    let earlyBird: { priceCents: number; until: Date } | null | undefined;
    if (b.earlyBird === null) earlyBird = null;
    else if (b.earlyBird !== undefined) {
      const e = b.earlyBird as Record<string, unknown>;
      const p = input.int(e?.priceCents, "Precio anticipado", 0, 10_000_000, false);
      const until = input.date(e?.until, "Fin del precio anticipado");
      if (p == null || !until) throw new BadRequestException("Precio anticipado: indica precio y fecha de fin");
      earlyBird = { priceCents: p, until };
    }

    return {
      fields,
      priceCents: priceCents ?? undefined,
      earlyBird,
      capacity: input.int(b.capacity, "Aforo", 0, 100_000),
    };
  }
}
