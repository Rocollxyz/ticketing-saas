import { BadRequestException } from "@nestjs/common";
import type { AttendeeAnswer } from "@ticketing/database";

export type AttendeeFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "select"
  | "checkbox"
  | "date"
  | "dni";

/** Campos estándar que el promotor añade con un clic (como en FooEvents/Eventbrite). */
export const ATTENDEE_PRESETS: Record<string, { label: string; type: AttendeeFieldType }> = {
  name: { label: "Nombre y apellidos", type: "text" },
  email: { label: "Email", type: "email" },
  phone: { label: "Teléfono", type: "phone" },
  company: { label: "Empresa", type: "text" },
  job: { label: "Cargo", type: "text" },
  dni: { label: "DNI / NIE", type: "dni" },
  birthdate: { label: "Fecha de nacimiento", type: "date" },
};

/** Lo mínimo de un campo que hace falta para validar una respuesta. */
export interface FieldDef {
  id: string;
  presetKey: string | null;
  label: string;
  type: AttendeeFieldType;
  required: boolean;
  options: string[] | null;
  ticketTypeIds: string[] | null;
  showOnTicket: boolean;
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** DNI (8 cifras + letra) o NIE (X/Y/Z + 7 cifras + letra) con letra de control correcta. */
export function isValidDni(raw: string): boolean {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(v);
  if (!m) return false;
  const [, nie, digits, letter] = m;
  if (nie ? digits.length !== 7 : digits.length !== 8) return false;
  const num = Number(`${nie ? "XYZ".indexOf(nie) : ""}${digits}`);
  return DNI_LETTERS[num % 23] === letter;
}

/** Valida y normaliza UNA respuesta. Devuelve null si está vacía; lanza si es inválida. */
function normalize(field: FieldDef, raw: unknown, who: string): string | null {
  if (field.type === "checkbox") {
    const on = raw === true || raw === "true" || raw === "on";
    if (field.required && !on) throw new BadRequestException(`${who}: debes marcar «${field.label}»`);
    return on ? "Sí" : null;
  }
  if (raw == null || raw === "") {
    if (field.required) throw new BadRequestException(`${who}: «${field.label}» es obligatorio`);
    return null;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new BadRequestException(`${who}: «${field.label}» no es válido`);
  }
  const v = String(raw).trim();
  if (!v) return normalize(field, null, who);
  const max = field.type === "textarea" ? 2_000 : 300;
  const bad = (msg: string): never => {
    throw new BadRequestException(`${who}: «${field.label}» ${msg}`);
  };
  if (v.length > max) bad(`supera los ${max} caracteres`);
  switch (field.type) {
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad("no es un email válido");
      return v.toLowerCase();
    case "phone":
      if (!/^\+?[\d\s().-]{6,20}$/.test(v)) bad("no es un teléfono válido");
      return v;
    case "number":
      if (!/^-?\d+([.,]\d+)?$/.test(v)) bad("debe ser un número");
      return v.replace(",", ".");
    case "date": {
      const d = new Date(`${v}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) bad("no es una fecha válida");
      return v;
    }
    case "select":
      if (!field.options?.includes(v)) bad("no es una opción válida");
      return v;
    case "dni":
      if (!isValidDni(v)) bad("no es un DNI/NIE válido");
      return v.toUpperCase().replace(/[\s-]/g, "");
    default:
      return v;
  }
}

/** Campos que aplican a una categoría (null en ticketTypeIds = todas). */
export const fieldsFor = (fields: FieldDef[], ticketTypeId: string | null) =>
  fields.filter((f) => !f.ticketTypeIds?.length || (ticketTypeId != null && f.ticketTypeIds.includes(ticketTypeId)));

/**
 * Valida los datos de TODOS los asistentes de una reserva. `attendees` llega del
 * comprador como [{seatId, values: {fieldId: valor}}]. Devuelve, por plaza, la lista de
 * respuestas ya normalizadas (copia fija con la etiqueta actual).
 */
export function validateAttendees(
  fields: FieldDef[],
  seats: { seatId: string; ticketTypeId: string | null }[],
  attendees: unknown,
): Map<string, AttendeeAnswer[]> {
  const out = new Map<string, AttendeeAnswer[]>();
  if (fields.length === 0) return out;
  const list = Array.isArray(attendees) ? attendees : [];
  const bySeat = new Map<string, Record<string, unknown>>();
  for (const a of list) {
    if (a && typeof a === "object" && typeof (a as { seatId?: unknown }).seatId === "string") {
      const values = (a as { values?: unknown }).values;
      bySeat.set((a as { seatId: string }).seatId, values && typeof values === "object" ? (values as Record<string, unknown>) : {});
    }
  }
  seats.forEach((s, i) => {
    const who = `Entrada ${i + 1}`;
    const values = bySeat.get(s.seatId) ?? {};
    const answers: AttendeeAnswer[] = [];
    for (const f of fieldsFor(fields, s.ticketTypeId)) {
      const v = normalize(f, values[f.id], who);
      if (v != null) {
        answers.push({
          fieldId: f.id,
          label: f.label,
          value: v,
          ...(f.showOnTicket ? { onTicket: true } : {}),
          ...(f.presetKey ? { preset: f.presetKey } : {}),
        });
      }
    }
    out.set(s.seatId, answers);
  });
  return out;
}

/** Nombre del asistente (del campo estándar "name"), para la entrada y el acceso. */
export const attendeeNameOf = (answers: AttendeeAnswer[] | null | undefined) =>
  answers?.find((a) => a.preset === "name")?.value ?? null;
