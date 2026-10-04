import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, asc, eq, sql } from "drizzle-orm";
import { qualified } from "../catalog/pricing";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

const MAX_AMOUNT_CENTS = 1_000_000;

/** Entradas vivas vendidas con cada tarifa. */
const soldSql = sql<number>`(
  select count(*) from ticket t where t.fare_id = ${qualified(schema.fare.id)} and t.status <> 'VOID'
)`.mapWith(Number);

/**
 * Tarifas de un evento (jubilado, estudiante…): el comprador elige una por entrada y
 * rebaja el precio de la categoría. La «general» es el precio de la categoría sin más.
 */
@Injectable()
export class FaresService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") throw new ForbiddenException("Solo el promotor puede gestionar las tarifas");
  }

  list(eventId: string) {
    this.assertPromoter();
    return this.db.run((tx) => this.listTx(tx, eventId));
  }

  private listTx(tx: Tx, eventId: string) {
    return tx
      .select({ fare: schema.fare, sold: soldSql })
      .from(schema.fare)
      .where(eq(schema.fare.eventId, eventId))
      .orderBy(asc(schema.fare.sortOrder), asc(schema.fare.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.fare, sold: r.sold })));
  }

  async create(eventId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      await this.assertEditableTx(tx, eventId);
      const d = await this.parse(tx, eventId, body, null);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${schema.fare.sortOrder}) + 1, 0)`.mapWith(Number) })
        .from(schema.fare)
        .where(eq(schema.fare.eventId, eventId));
      const [f] = await tx
        .insert(schema.fare)
        .values({ ...d, tenantId, eventId, name: d.name!, kind: d.kind!, value: d.value!, sortOrder: next })
        .returning();
      return f;
    });
  }

  async update(eventId: string, id: string, body: Record<string, unknown>) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.assertEditableTx(tx, eventId);
      const cur = await this.loadTx(tx, eventId, id);
      const d = await this.parse(tx, eventId, body, cur);
      const [f] = await tx
        .update(schema.fare)
        .set({ ...d, updatedAt: new Date() })
        .where(eq(schema.fare.id, id))
        .returning();
      return f;
    });
  }

  /** Borrar solo si nunca se reservó con ella; si no, se desactiva. */
  async remove(eventId: string, id: string) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.loadTx(tx, eventId, id);
      const [used] = await tx
        .select({ id: schema.holdSeat.id })
        .from(schema.holdSeat)
        .where(eq(schema.holdSeat.fareId, id))
        .limit(1);
      if (used) throw new ConflictException("Ya se han vendido o reservado entradas con esta tarifa: desactívala en lugar de borrarla");
      await tx.delete(schema.fare).where(eq(schema.fare.id, id));
      return { ok: true as const };
    });
  }

  private async assertEditableTx(tx: Tx, eventId: string) {
    const [ev] = await tx.select({ status: schema.event.status }).from(schema.event).where(eq(schema.event.id, eventId));
    if (!ev) throw new NotFoundException("Evento no encontrado");
    if (ev.status === "CANCELLED") throw new ConflictException("Un evento cancelado no se puede editar");
  }

  private async loadTx(tx: Tx, eventId: string, id: string) {
    const [f] = await tx
      .select()
      .from(schema.fare)
      .where(and(eq(schema.fare.id, id), eq(schema.fare.eventId, eventId)));
    if (!f) throw new NotFoundException("Tarifa no encontrada");
    return f;
  }

  private async parse(tx: Tx, eventId: string, b: Record<string, unknown>, cur: typeof schema.fare.$inferSelect | null) {
    const creating = cur === null;
    const name = input.text(b.name, "Nombre", 60, creating);
    if (name !== undefined && !name?.trim()) throw new BadRequestException("Nombre: obligatorio");
    const kind = input.oneOf(b.kind, "Tipo", ["PERCENT", "AMOUNT"] as const) ?? (creating ? undefined : cur.kind);
    if (!kind) throw new BadRequestException("Tipo: obligatorio");
    const value =
      (kind === "PERCENT"
        ? input.int(b.value, "Porcentaje", 1, 100, false)
        : input.int(b.value, "Importe", 1, MAX_AMOUNT_CENTS, false)) ?? (creating ? undefined : cur.value);
    if (value == null) throw new BadRequestException("Rebaja: obligatoria");
    if (kind === "PERCENT" && value > 100) throw new BadRequestException("Porcentaje: máximo 100");

    let ticketTypeIds: string[] | null | undefined;
    if (b.ticketTypeIds !== undefined) {
      const ids = b.ticketTypeIds;
      if (ids === null || (Array.isArray(ids) && ids.length === 0)) ticketTypeIds = null;
      else if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) throw new BadRequestException("Categorías inválidas");
      else {
        const valid = new Set(
          (await tx.select({ id: schema.ticketType.id }).from(schema.ticketType).where(eq(schema.ticketType.eventId, eventId))).map(
            (t) => t.id,
          ),
        );
        if (ids.some((i) => !valid.has(i))) throw new BadRequestException("Alguna categoría no es de este evento");
        ticketTypeIds = ids as string[];
      }
    }

    return input.defined({
      name: name?.trim(),
      requirement: input.text(b.requirement, "Requisito", 200),
      kind,
      value,
      ticketTypeIds,
      active: b.active === undefined ? undefined : b.active === true,
    });
  }
}
