import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { currentPriceCents } from "../catalog/pricing";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

export interface SeatPositionInput {
  seatId: string;
  posX: number | null;
  posY: number | null;
  ticketTypeId?: string | null;
}

export interface NewSeatInput {
  fila: string;
  numero: number;
  posX: number | null;
  posY: number | null;
  ticketTypeId?: string | null;
}

/** Elemento del plano que no es butaca: hueco (pasillo) o elemento con nombre. */
export interface MapFeatureInput {
  kind: "gap" | "label";
  label?: string | null;
  posX: number;
  posY: number;
}

export interface SeatmapChanges {
  seats?: SeatPositionInput[];
  created?: NewSeatInput[];
  deleted?: string[];
  /** Si viene, sustituye TODOS los elementos del plano (huecos y elementos con nombre). */
  features?: MapFeatureInput[];
}

const MAX_FEATURES = 2_000;

/** Valida los elementos del plano: tipo, nombre corto y una celda libre cada uno. */
function parseFeatures(list: unknown): MapFeatureInput[] {
  if (!Array.isArray(list)) throw new BadRequestException("Elementos del plano inválidos");
  if (list.length > MAX_FEATURES) throw new BadRequestException(`Máximo ${MAX_FEATURES} elementos en el plano`);
  const cells = new Set<string>();
  return list.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (f.kind !== "gap" && f.kind !== "label") throw new BadRequestException("Tipo de elemento inválido");
    if (!Number.isInteger(f.posX) || !Number.isInteger(f.posY) || (f.posX as number) < 0 || (f.posY as number) < 0) {
      throw new BadRequestException("Posición de elemento inválida");
    }
    const key = `${f.posX},${f.posY}`;
    if (cells.has(key)) throw new BadRequestException("Dos elementos en la misma celda");
    cells.add(key);
    const label = typeof f.label === "string" ? f.label.trim().slice(0, 24) : null;
    if (f.kind === "label" && !label) throw new BadRequestException("Un elemento con nombre necesita nombre");
    return { kind: f.kind, label: f.kind === "label" ? label : null, posX: f.posX as number, posY: f.posY as number };
  });
}

/** Postgres unique_violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

const isGridCoord = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0);

/**
 * Editor de mapa de asientos (promotor, Fase 3). Opera bajo el contexto de tenant
 * del JWT (RLS), así que un promotor solo ve/edita el plano de SUS eventos. La
 * geometría son coordenadas de rejilla por asiento (seat.pos_x/pos_y); la categoría
 * (ticket_type) también se asigna aquí.
 */
@Injectable()
export class SeatmapService {
  constructor(private readonly db: TenantDb) {}

  /** Plano completo del evento para el editor: asientos + categorías disponibles. */
  getSeatmap(eventId: string) {
    return this.db.run(async (tx) => {
      const [ev] = await tx
        .select({
          id: schema.event.id,
          name: schema.event.name,
          status: schema.event.status,
          seatingMode: schema.event.seatingMode,
        })
        .from(schema.event)
        .where(eq(schema.event.id, eventId));
      if (!ev) throw new NotFoundException("Evento no encontrado");

      const ticketTypes = await tx
        .select({
          id: schema.ticketType.id,
          name: schema.ticketType.name,
          precioCents: currentPriceCents(schema.ticketType.id),
        })
        .from(schema.ticketType)
        // Solo las numeradas: las generales no tienen asiento en el plano.
        .where(and(eq(schema.ticketType.eventId, eventId), eq(schema.ticketType.seating, "RESERVED")))
        .orderBy(schema.ticketType.sortOrder, schema.ticketType.name);

      const seats = await tx
        .select({
          id: schema.seat.id,
          fila: schema.seat.fila,
          numero: schema.seat.numero,
          posX: schema.seat.posX,
          posY: schema.seat.posY,
          zoneId: schema.seat.zoneId,
          ticketTypeId: schema.seat.ticketTypeId,
        })
        .from(schema.seat)
        .where(and(eq(schema.seat.eventId, eventId), eq(schema.seat.isGeneral, false)));

      const features = await tx
        .select({
          kind: schema.seatmapFeature.kind,
          label: schema.seatmapFeature.label,
          posX: schema.seatmapFeature.posX,
          posY: schema.seatmapFeature.posY,
        })
        .from(schema.seatmapFeature)
        .where(eq(schema.seatmapFeature.eventId, eventId));

      return {
        event: ev,
        features,
        ticketTypes: ticketTypes.map((t) => ({
          id: t.id,
          name: t.name,
          precioCents: t.precioCents,
        })),
        seats,
      };
    });
  }

  /**
   * Guarda el plano en UNA transacción: borra, recoloca/recategoriza y crea asientos.
   * Todo o nada — si algo falla (asiento con historial, fila+número repetido…) el
   * plano queda como estaba.
   */
  async saveSeatmap(eventId: string, changes: SeatmapChanges) {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede editar el plano");
    }
    const positions = changes.seats ?? [];
    const created = changes.created ?? [];
    const deleted = [...new Set(changes.deleted ?? [])];
    const features = changes.features === undefined ? null : parseFeatures(changes.features);
    if (positions.length + created.length + deleted.length === 0 && features === null) {
      throw new BadRequestException("Sin cambios");
    }
    if (positions.some((p) => deleted.includes(p.seatId))) {
      throw new BadRequestException("Un asiento no puede moverse y borrarse a la vez");
    }
    for (const p of positions) {
      if (!isGridCoord(p.posX) || !isGridCoord(p.posY)) {
        throw new BadRequestException("Posición inválida");
      }
    }
    const newSeats = created.map((c) => ({ ...c, fila: String(c.fila ?? "").trim().toUpperCase() }));
    const labels = new Set<string>();
    for (const c of newSeats) {
      if (!c.fila || c.fila.length > 10) throw new BadRequestException("Fila inválida");
      if (!Number.isInteger(c.numero) || c.numero < 1 || c.numero > 9999) {
        throw new BadRequestException("Número de asiento inválido");
      }
      if (!isGridCoord(c.posX) || !isGridCoord(c.posY)) {
        throw new BadRequestException("Posición inválida");
      }
      const label = `${c.fila}${c.numero}`;
      if (labels.has(label)) throw new BadRequestException(`Asiento ${label} repetido`);
      labels.add(label);
    }

    return this.db.run(async (tx) => {
      const [ev] = await tx
        .select({ seatingMode: schema.event.seatingMode })
        .from(schema.event)
        .where(eq(schema.event.id, eventId));
      if (!ev) throw new NotFoundException("Evento no encontrado");
      if (ev.seatingMode !== "RESERVED") {
        throw new BadRequestException("El plano solo aplica a eventos con asientos numerados");
      }

      // Validación: todos los asientos deben pertenecer a ESTE evento (defensa en
      // profundidad; RLS ya impide cruzar de tenant, pero no de evento).
      const ids = [...positions.map((p) => p.seatId), ...deleted];
      if (ids.length) {
        const owned = await tx
          .select({ id: schema.seat.id })
          .from(schema.seat)
          .where(and(eq(schema.seat.eventId, eventId), inArray(schema.seat.id, ids)));
        if (owned.length !== ids.length) {
          throw new BadRequestException("Algún asiento no pertenece al evento");
        }
      }

      // Categorías válidas del evento, para no asignar una de otro evento/tenant.
      const validTypes = new Set(
        (
          await tx
            .select({ id: schema.ticketType.id })
            .from(schema.ticketType)
            .where(and(eq(schema.ticketType.eventId, eventId), eq(schema.ticketType.seating, "RESERVED")))
        ).map((t) => t.id),
      );

      const checkType = (id: string | null | undefined) => {
        if (id != null && !validTypes.has(id)) {
          throw new BadRequestException("Categoría inválida para el plano (¿es una entrada general?)");
        }
      };

      // 1) Borrado. Un asiento con historial (holds, aunque expirados, o entradas)
      // NO se borra: es trazabilidad de ventas/accesos y la FK lo impediría igual.
      if (deleted.length) {
        const used = await tx
          .selectDistinct({ fila: schema.seat.fila, numero: schema.seat.numero })
          .from(schema.seat)
          .leftJoin(schema.holdSeat, eq(schema.holdSeat.seatId, schema.seat.id))
          .leftJoin(schema.ticket, eq(schema.ticket.seatId, schema.seat.id))
          .where(
            and(
              inArray(schema.seat.id, deleted),
              or(isNotNull(schema.holdSeat.id), isNotNull(schema.ticket.id)),
            ),
          );
        if (used.length) {
          const list = used.map((u) => `${u.fila}${u.numero}`).join(", ");
          throw new ConflictException(
            `No se pueden eliminar asientos con reservas o entradas: ${list}`,
          );
        }
        await tx
          .delete(schema.seat)
          .where(and(eq(schema.seat.eventId, eventId), inArray(schema.seat.id, deleted)));
      }

      // 2) Recolocar / recategorizar.
      for (const p of positions) {
        const patch: Partial<typeof schema.seat.$inferInsert> = { posX: p.posX, posY: p.posY };
        if (p.ticketTypeId !== undefined) {
          checkType(p.ticketTypeId);
          patch.ticketTypeId = p.ticketTypeId;
        }
        await tx
          .update(schema.seat)
          .set(patch)
          .where(and(eq(schema.seat.id, p.seatId), eq(schema.seat.eventId, eventId)));
      }

      // 3) Alta. Los asientos nuevos van a la zona del evento (hoy una por evento;
      // si no hay ninguna se crea "General").
      if (newSeats.length) {
        newSeats.forEach((c) => checkType(c.ticketTypeId));
        let [zn] = await tx
          .select({ id: schema.zone.id })
          .from(schema.zone)
          .where(eq(schema.zone.eventId, eventId))
          .orderBy(schema.zone.createdAt)
          .limit(1);
        if (!zn) {
          [zn] = await tx
            .insert(schema.zone)
            .values({ tenantId: getStore()!.tenantId, eventId, name: "General" })
            .returning({ id: schema.zone.id });
        }
        try {
          await tx.insert(schema.seat).values(
            newSeats.map((c) => ({
              tenantId: getStore()!.tenantId,
              eventId,
              zoneId: zn.id,
              fila: c.fila,
              numero: c.numero,
              posX: c.posX,
              posY: c.posY,
              ticketTypeId: c.ticketTypeId ?? null,
            })),
          );
        } catch (e) {
          if (isUniqueViolation(e)) {
            throw new ConflictException("Ya existe un asiento con esa fila y número");
          }
          throw e;
        }
      }

      // 4) Elementos del plano: se sustituyen todos (son pocos y sin historial).
      if (features !== null) {
        await tx.delete(schema.seatmapFeature).where(eq(schema.seatmapFeature.eventId, eventId));
        if (features.length) {
          await tx.insert(schema.seatmapFeature).values(
            features.map((f) => ({ ...f, tenantId: getStore()!.tenantId, eventId })),
          );
        }
      }

      return {
        updated: positions.length,
        created: newSeats.length,
        deleted: deleted.length,
        features: features?.length ?? null,
      };
    });
  }
}
