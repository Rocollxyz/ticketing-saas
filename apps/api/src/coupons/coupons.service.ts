import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema } from "@ticketing/database";
import { desc, eq, isNull, or, sql } from "drizzle-orm";
import { normalizeCode } from "../catalog/coupon";
import { qualified } from "../catalog/pricing";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

const MAX_AMOUNT_CENTS = 1_000_000;

/** Usos (pedidos no cancelados) y descuento total concedido, por cupón. */
const usesSql = sql<number>`(
  select count(*) from "order" o where o.coupon_id = ${qualified(schema.coupon.id)} and o.status <> 'CANCELLED'
)`.mapWith(Number);
const discountedSql = sql<number>`(
  select coalesce(sum(o.discount_cents), 0) from "order" o
  where o.coupon_id = ${qualified(schema.coupon.id)} and o.status = 'PAID'
)`.mapWith(Number);

/**
 * Códigos de descuento del promotor. Un cupón vale para un evento concreto (y,
 * opcionalmente, solo para algunas de sus categorías) o para todos sus eventos.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede gestionar los códigos de descuento");
    }
  }

  /** Cupones de un evento + los que valen para todos los eventos. Sin `eventId`, todos. */
  list(eventId?: string) {
    this.assertPromoter();
    return this.db.run((tx) =>
      tx
        .select({ coupon: schema.coupon, uses: usesSql, discountedCents: discountedSql })
        .from(schema.coupon)
        .where(eventId ? or(eq(schema.coupon.eventId, eventId), isNull(schema.coupon.eventId)) : undefined)
        .orderBy(desc(schema.coupon.createdAt))
        .then((rows) => rows.map((r) => ({ ...r.coupon, uses: r.uses, discountedCents: r.discountedCents }))),
    );
  }

  async create(body: Record<string, unknown>) {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const d = await this.parse(tx, body, null);
      try {
        const [c] = await tx
          .insert(schema.coupon)
          .values({ ...d, tenantId, code: d.code!, kind: d.kind!, value: d.value! })
          .returning();
        return c;
      } catch (e) {
        throw this.duplicate(e, d.code!);
      }
    });
  }

  async update(id: string, body: Record<string, unknown>) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      const cur = await this.loadTx(tx, id);
      const d = await this.parse(tx, body, cur);
      try {
        const [c] = await tx
          .update(schema.coupon)
          .set({ ...d, updatedAt: new Date() })
          .where(eq(schema.coupon.id, id))
          .returning();
        return c;
      } catch (e) {
        throw this.duplicate(e, d.code ?? cur.code);
      }
    });
  }

  /** Borrar solo si nunca se usó; si no, se desactiva (los pedidos lo referencian). */
  async remove(id: string) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.loadTx(tx, id);
      const [used] = await tx
        .select({ id: schema.order.id })
        .from(schema.order)
        .where(eq(schema.order.couponId, id))
        .limit(1);
      if (used) throw new ConflictException("Este código ya se ha usado: desactívalo en lugar de borrarlo");
      await tx.delete(schema.coupon).where(eq(schema.coupon.id, id));
      return { ok: true as const };
    });
  }

  private async loadTx(tx: Tx, id: string) {
    const [c] = await tx.select().from(schema.coupon).where(eq(schema.coupon.id, id));
    if (!c) throw new NotFoundException("Código no encontrado");
    return c;
  }

  private duplicate(e: unknown, code: string) {
    return (e as { code?: string }).code === "23505"
      ? new ConflictException(`Ya tienes un código «${code}»`)
      : e;
  }

  private async parse(tx: Tx, b: Record<string, unknown>, cur: typeof schema.coupon.$inferSelect | null) {
    const creating = cur === null;
    let code: string | undefined;
    if (b.code !== undefined || creating) {
      const raw = input.text(b.code, "Código", 40, true)!;
      code = normalizeCode(raw);
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
        throw new BadRequestException("Código: de 3 a 40 letras, números, guiones o guiones bajos (sin espacios)");
      }
    }

    const kind = input.oneOf(b.kind, "Tipo", ["PERCENT", "AMOUNT"] as const) ?? (creating ? undefined : cur.kind);
    if (!kind) throw new BadRequestException("Tipo: obligatorio");
    const value = (
      kind === "PERCENT"
        ? input.int(b.value, "Porcentaje", 1, 100, false)
        : input.int(b.value, "Importe", 1, MAX_AMOUNT_CENTS, false)
    ) ?? (creating ? undefined : cur.value);
    if (value == null) throw new BadRequestException("Valor del descuento: obligatorio");
    if (kind === "PERCENT" && value > 100) throw new BadRequestException("Porcentaje: máximo 100");

    // Evento (null = todos) y categorías de ese evento.
    let eventId: string | null | undefined;
    if (b.eventId !== undefined) {
      eventId = b.eventId === null || b.eventId === "" ? null : String(b.eventId);
      if (eventId) {
        const [ev] = await tx.select({ id: schema.event.id }).from(schema.event).where(eq(schema.event.id, eventId));
        if (!ev) throw new BadRequestException("Evento no encontrado");
      }
    }
    const targetEvent = eventId !== undefined ? eventId : (cur?.eventId ?? null);

    let ticketTypeIds: string[] | null | undefined;
    if (b.ticketTypeIds !== undefined) {
      const ids = b.ticketTypeIds;
      if (ids === null || (Array.isArray(ids) && ids.length === 0)) ticketTypeIds = null;
      else if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
        throw new BadRequestException("Categorías inválidas");
      } else {
        if (!targetEvent) throw new BadRequestException("Para limitar por categorías, el código debe ser de un evento");
        const valid = new Set(
          (
            await tx
              .select({ id: schema.ticketType.id })
              .from(schema.ticketType)
              .where(eq(schema.ticketType.eventId, targetEvent))
          ).map((t) => t.id),
        );
        if (ids.some((i) => !valid.has(i))) throw new BadRequestException("Alguna categoría no es de este evento");
        ticketTypeIds = ids as string[];
      }
    } else if (eventId === null) {
      ticketTypeIds = null; // pasa a valer para todos los eventos: sin categorías
    }

    const maxUses = input.int(b.maxUses, "Usos máximos", 1, 1_000_000);
    const validFrom = input.date(b.validFrom, "Válido desde");
    const validTo = input.date(b.validTo, "Válido hasta");
    const from = validFrom !== undefined ? validFrom : (cur?.validFrom ?? null);
    const to = validTo !== undefined ? validTo : (cur?.validTo ?? null);
    if (from && to && from >= to) throw new BadRequestException("La fecha de fin debe ser posterior a la de inicio");

    return input.defined({
      code,
      kind,
      value,
      eventId,
      ticketTypeIds,
      maxUses,
      validFrom,
      validTo,
      active: b.active === undefined ? undefined : b.active === true,
    });
  }
}
