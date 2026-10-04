import { BadRequestException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq } from "drizzle-orm";
import type { TenantDb } from "../database/tenant-db.service";
import { currentPriceCents } from "./pricing";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];
type Fare = Pick<typeof schema.fare.$inferSelect, "kind" | "value" | "ticketTypeIds">;

/** ¿La tarifa vale para esa categoría? (sin lista = todas las del evento) */
export function fareApplies(fare: Fare, ticketTypeId: string) {
  return !fare.ticketTypeIds?.length || fare.ticketTypeIds.includes(ticketTypeId);
}

/**
 * Precio con tarifa a partir del vigente de la categoría (normal o anticipada): un % de
 * rebaja (redondeado al céntimo) o un importe fijo menos, nunca por debajo de 0.
 */
export function farePrice(baseCents: number, fare: Fare | null) {
  if (!fare) return baseCents;
  const off = fare.kind === "PERCENT" ? Math.round((baseCents * fare.value) / 100) : fare.value;
  return Math.max(0, baseCents - off);
}

/**
 * Asigna la tarifa de cada plaza reservada: `fares` = [{ seatId?, ticketTypeId?, fareId }].
 * En numerado se casa por asiento; en general, por orden dentro de cada categoría (quien
 * compra no sabe qué plaza concreta le tocó). Lo que no se indique va a la general. La
 * tarifa tiene que ser del evento, estar activa y valer para la categoría de la plaza.
 */
export async function assignFaresTx(tx: Tx, eventId: string, holdId: string, fares: unknown) {
  const seats = await tx
    .select({ id: schema.holdSeat.id, seatId: schema.holdSeat.seatId, ticketTypeId: schema.seat.ticketTypeId })
    .from(schema.holdSeat)
    .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
    .where(eq(schema.holdSeat.holdId, holdId))
    .orderBy(schema.seat.numero);
  const matched = await resolveFaresTx(tx, eventId, seats, fares);
  for (const [i, s] of seats.entries()) {
    await tx.update(schema.holdSeat).set({ fareId: matched[i]?.id ?? null }).where(eq(schema.holdSeat.id, s.id));
  }
}

/**
 * Casa la lista de tarifas pedida con las plazas (por asiento o, en general, por orden en
 * su categoría) y la valida. Devuelve la tarifa de cada plaza (null = general).
 */
export async function resolveFaresTx(
  tx: Tx,
  eventId: string,
  items: { seatId?: string | null; ticketTypeId: string | null }[],
  fares: unknown,
) {
  if (fares != null && !Array.isArray(fares)) throw new BadRequestException("Tarifas inválidas");
  const pending = ((fares as unknown[] | null) ?? []).map((f) => {
    const o = (f ?? {}) as { seatId?: unknown; ticketTypeId?: unknown; fareId?: unknown };
    if (o.fareId != null && typeof o.fareId !== "string") throw new BadRequestException("Tarifa inválida");
    return { seatId: o.seatId, ticketTypeId: o.ticketTypeId, fareId: (o.fareId as string | null) ?? null };
  });
  const available = pending.some((f) => f.fareId)
    ? await tx
        .select()
        .from(schema.fare)
        .where(and(eq(schema.fare.eventId, eventId), eq(schema.fare.active, true)))
    : [];
  const byId = new Map(available.map((f) => [f.id, f]));
  // Primero las que van por asiento; luego, las de general por categoría y orden.
  const out: (typeof schema.fare.$inferSelect | null)[] = items.map(() => null);
  const take = (pred: (f: (typeof pending)[number]) => boolean) => {
    const i = pending.findIndex(pred);
    return i >= 0 ? pending.splice(i, 1)[0] : undefined;
  };
  const picks = items.map((it) => (it.seatId ? take((f) => f.seatId === it.seatId) : undefined));
  for (const [i, it] of items.entries()) {
    const f = picks[i] ?? take((p) => !p.seatId && p.ticketTypeId === it.ticketTypeId);
    if (!f?.fareId) continue;
    const fare = byId.get(f.fareId);
    if (!fare) throw new BadRequestException("Esa tarifa ya no está disponible");
    if (!it.ticketTypeId || !fareApplies(fare, it.ticketTypeId)) {
      throw new BadRequestException(`La tarifa «${fare.name}» no vale para esa entrada`);
    }
    out[i] = fare;
  }
  return out;
}

/** Precio de cada plaza reservada: el vigente de su categoría con su tarifa aplicada. */
export async function priceHoldSeatsTx(tx: Tx, holdId: string, seatCount: number) {
  const rows = await tx
    .select({
      id: schema.holdSeat.id,
      seatId: schema.holdSeat.seatId,
      ticketTypeId: schema.ticketType.id,
      base: currentPriceCents(schema.ticketType.id),
      fare: schema.fare,
    })
    .from(schema.holdSeat)
    .innerJoin(schema.seat, eq(schema.seat.id, schema.holdSeat.seatId))
    .innerJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
    .leftJoin(schema.fare, eq(schema.fare.id, schema.holdSeat.fareId))
    .where(eq(schema.holdSeat.holdId, holdId));
  if (rows.length !== seatCount || rows.some((p) => p.base == null)) {
    throw new BadRequestException("Hay asientos sin precio asignado");
  }
  return rows.map((r) => ({
    id: r.id,
    seatId: r.seatId,
    ticketTypeId: r.ticketTypeId,
    amountCents: farePrice(Number(r.base), r.fare),
  }));
}
