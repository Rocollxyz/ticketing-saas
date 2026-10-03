import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, asc, eq } from "drizzle-orm";
import { ATTENDEE_PRESETS, type AttendeeFieldType } from "../catalog/attendee";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

const TYPES: readonly AttendeeFieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "select",
  "checkbox",
  "date",
  "dni",
];
const MAX_FIELDS = 30;

/**
 * Formulario de asistentes de un evento (qué datos se piden por cada entrada). Las
 * respuestas se guardan como copia fija en cada entrada, así que cambiar o borrar un
 * campo con ventas no altera lo que ya se respondió.
 */
@Injectable()
export class AttendeeFieldsService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede editar el formulario");
    }
  }

  list(eventId: string) {
    return this.db.run((tx) => listTx(tx, eventId));
  }

  async create(eventId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      await this.editableEventTx(tx, eventId);
      const current = await listTx(tx, eventId);
      if (current.length >= MAX_FIELDS) throw new BadRequestException(`Máximo ${MAX_FIELDS} campos`);

      // Campo estándar: etiqueta y tipo salen del preset (se pueden cambiar después).
      const preset = typeof body.presetKey === "string" ? body.presetKey : null;
      if (preset) {
        if (!ATTENDEE_PRESETS[preset]) throw new BadRequestException("Campo estándar desconocido");
        if (current.some((f) => f.presetKey === preset)) {
          throw new ConflictException(`El formulario ya tiene «${ATTENDEE_PRESETS[preset].label}»`);
        }
      }
      const d = await this.parse(tx, eventId, {
        label: ATTENDEE_PRESETS[preset ?? ""]?.label,
        type: ATTENDEE_PRESETS[preset ?? ""]?.type,
        ...body,
      }, true);
      const [f] = await tx
        .insert(schema.attendeeField)
        .values({
          ...d,
          label: d.label!,
          type: d.type!,
          tenantId,
          eventId,
          presetKey: preset,
          sortOrder: d.sortOrder ?? (current.at(-1)?.sortOrder ?? 0) + 1,
        })
        .returning();
      return f;
    });
  }

  async update(eventId: string, fieldId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.editableEventTx(tx, eventId);
      const [cur] = await tx
        .select()
        .from(schema.attendeeField)
        .where(and(eq(schema.attendeeField.id, fieldId), eq(schema.attendeeField.eventId, eventId)));
      if (!cur) throw new NotFoundException("Campo no encontrado");
      const d = await this.parse(tx, eventId, body, false);
      if ((d.type ?? cur.type) === "select" && !(d.options ?? cur.options)?.length) {
        throw new BadRequestException("Un desplegable necesita al menos una opción");
      }
      const [f] = await tx
        .update(schema.attendeeField)
        .set({ ...d, updatedAt: new Date() })
        .where(eq(schema.attendeeField.id, fieldId))
        .returning();
      return f;
    });
  }

  async remove(eventId: string, fieldId: string) {
    this.assertPromoter();
    return this.db.run(async (tx) => {
      await this.editableEventTx(tx, eventId);
      const [f] = await tx
        .delete(schema.attendeeField)
        .where(and(eq(schema.attendeeField.id, fieldId), eq(schema.attendeeField.eventId, eventId)))
        .returning({ id: schema.attendeeField.id });
      if (!f) throw new NotFoundException("Campo no encontrado");
      return { ok: true };
    });
  }

  /** Reordenar: recibe los ids en el orden deseado. */
  async reorder(eventId: string, ids: unknown) {
    this.assertPromoter();
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
      throw new BadRequestException("Orden inválido");
    }
    return this.db.run(async (tx) => {
      await this.editableEventTx(tx, eventId);
      const current = await listTx(tx, eventId);
      if (ids.length !== current.length || current.some((f) => !ids.includes(f.id))) {
        throw new BadRequestException("El orden debe incluir todos los campos del evento");
      }
      for (const [i, id] of (ids as string[]).entries()) {
        await tx.update(schema.attendeeField).set({ sortOrder: i + 1 }).where(eq(schema.attendeeField.id, id));
      }
      return listTx(tx, eventId);
    });
  }

  private async editableEventTx(tx: Tx, eventId: string) {
    const [ev] = await tx
      .select({ status: schema.event.status })
      .from(schema.event)
      .where(eq(schema.event.id, eventId));
    if (!ev) throw new NotFoundException("Evento no encontrado");
    if (ev.status === "CANCELLED") throw new ConflictException("Un evento cancelado no se puede editar");
  }

  private async parse(tx: Tx, eventId: string, b: Record<string, unknown>, creating: boolean) {
    const type = input.oneOf(b.type, "Tipo", TYPES);
    let options: string[] | null | undefined;
    if (b.options !== undefined) {
      if (b.options === null) options = null;
      else if (!Array.isArray(b.options)) throw new BadRequestException("Opciones inválidas");
      else {
        options = [...new Set(b.options.map((o) => String(o).trim()).filter(Boolean))];
        if (options.length > 50 || options.some((o) => o.length > 100)) {
          throw new BadRequestException("Máximo 50 opciones de 100 caracteres");
        }
      }
    }
    if (creating && type === "select" && !options?.length) {
      throw new BadRequestException("Un desplegable necesita al menos una opción");
    }

    let ticketTypeIds: string[] | null | undefined;
    if (b.ticketTypeIds !== undefined) {
      if (b.ticketTypeIds === null || (Array.isArray(b.ticketTypeIds) && b.ticketTypeIds.length === 0)) {
        ticketTypeIds = null;
      } else if (!Array.isArray(b.ticketTypeIds)) {
        throw new BadRequestException("Categorías inválidas");
      } else {
        const valid = new Set(
          (
            await tx
              .select({ id: schema.ticketType.id })
              .from(schema.ticketType)
              .where(eq(schema.ticketType.eventId, eventId))
          ).map((t) => t.id),
        );
        if (b.ticketTypeIds.some((id) => typeof id !== "string" || !valid.has(id))) {
          throw new BadRequestException("Alguna categoría no es de este evento");
        }
        ticketTypeIds = b.ticketTypeIds as string[];
      }
    }

    const bool = (v: unknown) => (v === undefined ? undefined : v === true);
    return input.defined({
      label: input.text(b.label, "Etiqueta", 100, creating || b.label !== undefined) ?? undefined,
      type,
      required: bool(b.required),
      helpText: input.text(b.helpText, "Ayuda", 200),
      options,
      ticketTypeIds,
      showOnTicket: bool(b.showOnTicket),
      sortOrder: input.int(b.sortOrder, "Orden", 0, 1_000, false) ?? undefined,
    });
  }
}

/** Campos del evento en orden (también lo usan la tienda y el checkout). */
export function listTx(tx: Tx, eventId: string) {
  return tx
    .select()
    .from(schema.attendeeField)
    .where(eq(schema.attendeeField.eventId, eventId))
    .orderBy(asc(schema.attendeeField.sortOrder), asc(schema.attendeeField.createdAt));
}
