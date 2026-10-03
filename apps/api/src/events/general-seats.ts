import { ConflictException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { qualified } from "../catalog/pricing";
import type { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

const MAX_CAPACITY = 100_000;
const CHUNK = 2_000;

/** ¿El asiento tiene historial (holds, aunque expirados, o entradas)? Entonces no se borra. */
export const seatHasHistory = sql`(
  exists (select 1 from hold_seat hs where hs.seat_id = ${qualified(schema.seat.id)})
  or exists (select 1 from ticket tk where tk.seat_id = ${qualified(schema.seat.id)})
)`;

/** Zona del evento donde van las plazas nuevas (se crea "General" si no hay). */
export async function ensureZone(tx: Tx, tenantId: string, eventId: string): Promise<string> {
  const [zn] = await tx
    .select({ id: schema.zone.id })
    .from(schema.zone)
    .where(eq(schema.zone.eventId, eventId))
    .orderBy(schema.zone.createdAt)
    .limit(1);
  if (zn) return zn.id;
  const [created] = await tx
    .insert(schema.zone)
    .values({ tenantId, eventId, name: "General" })
    .returning({ id: schema.zone.id });
  return created.id;
}

/**
 * ENTRADA GENERAL: el aforo de una categoría son N plazas `seat` is_general (fila
 * "GA", numeración por evento). Así la venta por cantidad reutiliza íntegra la
 * anti-sobreventa por asiento. Ajusta las plazas al aforo pedido: crea las que falten
 * o borra las sobrantes que NUNCA se han reservado (las más altas primero). Si el
 * aforo pedido es menor que lo ya vendido/reservado → 409.
 */
export async function syncGeneralSeats(
  tx: Tx,
  tenantId: string,
  eventId: string,
  ticketTypeId: string,
  capacity: number,
) {
  if (capacity > MAX_CAPACITY) throw new ConflictException(`Aforo máximo ${MAX_CAPACITY}`);
  const current = await tx
    .select({ id: schema.seat.id, used: sql<boolean>`${seatHasHistory}` })
    .from(schema.seat)
    .where(
      and(
        eq(schema.seat.eventId, eventId),
        eq(schema.seat.ticketTypeId, ticketTypeId),
        eq(schema.seat.isGeneral, true),
      ),
    )
    .orderBy(desc(schema.seat.numero));

  if (capacity > current.length) {
    const zoneId = await ensureZone(tx, tenantId, eventId);
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.seat.numero}), 0)`.mapWith(Number) })
      .from(schema.seat)
      .where(and(eq(schema.seat.eventId, eventId), eq(schema.seat.isGeneral, true)));
    const rows = Array.from({ length: capacity - current.length }, (_, i) => ({
      tenantId,
      eventId,
      zoneId,
      ticketTypeId,
      fila: "GA",
      numero: max + i + 1,
      isGeneral: true,
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(schema.seat).values(rows.slice(i, i + CHUNK));
    }
  } else if (capacity < current.length) {
    const removable = current.filter((s) => !s.used);
    const toRemove = current.length - capacity;
    if (removable.length < toRemove) {
      const used = current.length - removable.length;
      throw new ConflictException(
        `No se puede bajar el aforo a ${capacity}: ya hay ${used} entradas vendidas o reservadas`,
      );
    }
    const ids = removable.slice(0, toRemove).map((s) => s.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      await tx.delete(schema.seat).where(inArray(schema.seat.id, ids.slice(i, i + CHUNK)));
    }
  }
}
