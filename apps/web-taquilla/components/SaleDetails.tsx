"use client";

import type { BillingData, PosAttendeeField } from "../lib/api";

/** Una plaza de la venta en curso, con los datos que hay que pedir para ella. */
export interface Slot {
  key: string;
  label: string;
  seatId?: string;
  ticketTypeId: string | null;
  fields: PosAttendeeField[];
}

export type SlotValues = Record<string, Record<string, string | boolean>>;

export const EMPTY_BILLING: BillingData = { name: "", taxId: "", address: "", postalCode: "", city: "" };

/** Campos que aplican a una categoría (sin categorías = todas). */
export const fieldsFor = (fields: PosAttendeeField[], ticketTypeId: string | null) =>
  fields.filter((f) => !f.ticketTypeIds?.length || (ticketTypeId != null && f.ticketTypeIds.includes(ticketTypeId)));

/** ¿Falta algún obligatorio? (la API valida el resto, p. ej. la letra del DNI). */
export function missingRequired(slots: Slot[], values: SlotValues): string | null {
  for (const s of slots) {
    for (const f of s.fields) {
      const v = values[s.key]?.[f.id];
      if (f.required && (v === undefined || v === "" || v === false)) return `${s.label}: falta «${f.label}»`;
    }
  }
  return null;
}

const INPUT: Record<string, string> = { email: "email", phone: "tel", date: "date" };

/**
 * Datos de asistentes por plaza (si el evento los pide) y, opcionalmente, datos para
 * factura completa. Formulario compacto: en mostrador hay prisa.
 */
export default function SaleDetails({
  slots,
  values,
  onValues,
  invoice,
  onInvoice,
  billing,
  onBilling,
  totalCents,
}: {
  slots: Slot[];
  values: SlotValues;
  onValues: (v: SlotValues) => void;
  invoice: boolean;
  onInvoice: (v: boolean) => void;
  billing: BillingData;
  onBilling: (b: BillingData) => void;
  totalCents: number;
}) {
  const withFields = slots.filter((s) => s.fields.length > 0);
  const set = (slot: string, field: string, v: string | boolean) =>
    onValues({ ...values, [slot]: { ...(values[slot] ?? {}), [field]: v } });

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
      {withFields.map((s) => (
        <div key={s.key} style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {s.fields.map((f) =>
              f.type === "checkbox" ? (
                <label key={f.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={values[s.key]?.[f.id] === true}
                    onChange={(e) => set(s.key, f.id, e.target.checked)}
                  />
                  {f.label}
                  {f.required && " *"}
                </label>
              ) : f.type === "select" ? (
                <select
                  key={f.id}
                  value={String(values[s.key]?.[f.id] ?? "")}
                  onChange={(e) => set(s.key, f.id, e.target.value)}
                  style={input}
                >
                  <option value="">{f.label}{f.required ? " *" : ""}</option>
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  key={f.id}
                  type={INPUT[f.type] ?? "text"}
                  placeholder={`${f.label}${f.required ? " *" : ""}`}
                  title={f.label}
                  value={String(values[s.key]?.[f.id] ?? "")}
                  onChange={(e) => set(s.key, f.id, e.target.value)}
                  style={input}
                />
              ),
            )}
          </div>
        </div>
      ))}

      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#9aa3b2" }}>
        <input type="checkbox" checked={invoice} onChange={(e) => onInvoice(e.target.checked)} />
        Factura completa (empresa o autónomo)
        {totalCents > 40_000 && !invoice && (
          <span style={{ color: "#e0a23c" }}> · más de 400 €: la ley exige factura completa</span>
        )}
      </label>
      {invoice && (
        <div style={{ ...box, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(
            [
              ["name", "Nombre o razón social"],
              ["taxId", "NIF"],
              ["address", "Dirección"],
              ["postalCode", "Código postal"],
              ["city", "Población"],
            ] as const
          ).map(([k, label]) => (
            <input
              key={k}
              placeholder={`${label} *`}
              value={billing[k]}
              onChange={(e) => onBilling({ ...billing, [k]: e.target.value })}
              style={input}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const box: React.CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid #2b313c", background: "#0f1115" };
const input: React.CSSProperties = {
  flex: "1 1 160px",
  padding: 8,
  borderRadius: 6,
  border: "1px solid #2b313c",
  background: "#171a21",
  color: "#e9edf2",
  fontSize: 13,
};
