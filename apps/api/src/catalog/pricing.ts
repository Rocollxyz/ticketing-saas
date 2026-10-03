import { type AnyColumn, type Column, getTableName, sql } from "drizzle-orm";

/**
 * Columna SIEMPRE calificada ("tabla"."col"). Drizzle omite la tabla en selects de
 * una sola tabla, y dentro de una subconsulta correlacionada eso la vuelve ambigua.
 */
export const qualified = (col: AnyColumn) =>
  sql`${sql.identifier(getTableName((col as Column).table))}.${sql.identifier(col.name)}`;

/**
 * Precio VIGENTE de una categoría (fuente única: storefront, POS, checkout, editor,
 * email). Entre las filas de `price` válidas ahora, gana la que CADUCA ANTES: así un
 * precio anticipado (valid_to = fin de la anticipada) se impone al normal (sin
 * valid_to) mientras dure, y al caducar entra el normal sin tocar nada.
 * `null` = la categoría no tiene precio vigente (no se puede vender).
 */
export const currentPriceCents = (ticketTypeId: AnyColumn) =>
  sql<number | null>`(
    select p.amount_cents from price p
    where p.ticket_type_id = ${qualified(ticketTypeId)}
      and (p.valid_from is null or p.valid_from <= now())
      and (p.valid_to is null or p.valid_to > now())
    order by p.valid_to asc nulls last
    limit 1
  )`.mapWith(Number);

/**
 * ¿Está ocupado el asiento? Hold CONFIRMED (vendido) o ACTIVE aún no expirado. Misma
 * regla que el índice anti-sobreventa, pero sin depender de que el sweeper ya haya
 * marcado EXPIRED los holds caducados.
 */
export const seatTaken = (seatId: AnyColumn) =>
  sql<boolean>`exists (
    select 1 from hold_seat hs join hold h on h.id = hs.hold_id
    where hs.seat_id = ${qualified(seatId)}
      and (hs.status = 'CONFIRMED' or (hs.status = 'ACTIVE' and h.expires_at > now()))
  )`;
