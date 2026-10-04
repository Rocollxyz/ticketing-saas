import { BadRequestException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];
export type CouponRow = typeof schema.coupon.$inferSelect;

/** Una entrada del pedido con su precio vigente. */
export interface PricedLine {
  ticketTypeId: string;
  amountCents: number;
  seatId?: string;
}

/** Normaliza lo que teclea el comprador o el promotor: sin espacios y en mayúsculas. */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

/** Pedidos que ya han usado el cupón (los cancelados no cuentan: liberan el uso). */
export async function couponUsesTx(tx: Tx, couponId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.order)
    .where(and(eq(schema.order.couponId, couponId), ne(schema.order.status, "CANCELLED")));
  return r.n;
}

/** ¿Hay algún cupón activo y en fecha que pueda valer para este evento? */
export async function hasActiveCouponTx(tx: Tx, eventId: string): Promise<boolean> {
  const now = new Date();
  const [c] = await tx
    .select({ id: schema.coupon.id })
    .from(schema.coupon)
    .where(
      and(
        eq(schema.coupon.active, true),
        or(isNull(schema.coupon.eventId), eq(schema.coupon.eventId, eventId)),
        or(isNull(schema.coupon.validFrom), lte(schema.coupon.validFrom, now)),
        or(isNull(schema.coupon.validTo), gt(schema.coupon.validTo, now)),
      ),
    )
    .limit(1);
  return !!c;
}

/**
 * Descuento de CADA línea (mismo orden que `lines`): por entrada elegible, nunca por
 * debajo de 0. Se guarda por plaza para saber lo pagado por cada entrada (reembolsos).
 */
export function couponLineDiscounts(c: CouponRow, lines: PricedLine[]): number[] {
  return lines.map((l) => {
    if (c.ticketTypeIds?.length && !c.ticketTypeIds.includes(l.ticketTypeId)) return 0;
    const off = c.kind === "PERCENT" ? Math.round((l.amountCents * c.value) / 100) : c.value;
    return Math.min(off, l.amountCents);
  });
}

export const couponDiscount = (c: CouponRow, lines: PricedLine[]) =>
  couponLineDiscounts(c, lines).reduce((a, b) => a + b, 0);

/**
 * Busca el cupón y comprueba que vale para este pedido. Devuelve el cupón y el
 * descuento, o lanza 400 con el motivo para el comprador. Con `lock`, bloquea la
 * fila del cupón: dos pedidos simultáneos no pueden pasarse del límite de usos.
 */
export async function resolveCouponTx(
  tx: Tx,
  rawCode: string,
  eventId: string,
  lines: PricedLine[],
  lock = false,
): Promise<{ coupon: CouponRow; discountCents: number; lineDiscounts: number[] }> {
  const code = normalizeCode(rawCode);
  const q = tx.select().from(schema.coupon).where(eq(schema.coupon.code, code));
  const [c] = lock ? await q.for("update") : await q;
  if (!c || !c.active) throw new BadRequestException("Código de descuento no válido");
  if (c.eventId && c.eventId !== eventId) throw new BadRequestException("Este código no es válido para este evento");
  const now = Date.now();
  if (c.validFrom && c.validFrom.getTime() > now) throw new BadRequestException("Este código aún no está activo");
  if (c.validTo && c.validTo.getTime() <= now) throw new BadRequestException("Este código ha caducado");
  if (c.maxUses != null && (await couponUsesTx(tx, c.id)) >= c.maxUses) {
    throw new BadRequestException("Este código ya se ha agotado");
  }
  const lineDiscounts = couponLineDiscounts(c, lines);
  const discountCents = lineDiscounts.reduce((a, b) => a + b, 0);
  if (discountCents <= 0) throw new BadRequestException("Este código no se aplica a las entradas elegidas");
  return { coupon: c, discountCents, lineDiscounts };
}
