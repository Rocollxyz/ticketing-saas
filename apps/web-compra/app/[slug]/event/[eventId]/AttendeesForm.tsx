"use client";

import { useState } from "react";
import { type AttendeeFieldPublic, fieldsFor, type HeldSeat } from "../../../../lib/api";
import { inputStyle } from "./styles";

type Values = Record<string, string | boolean>;

/**
 * Datos de cada asistente (un bloque por entrada). Se rellena con las plazas ya
 * reservadas; la API valida de nuevo todo (incluida la letra del DNI) al crear el pago.
 */
export default function AttendeesForm({
  seats,
  fields,
  buyer,
  busy,
  error,
  onSubmit,
}: {
  seats: HeldSeat[];
  fields: AttendeeFieldPublic[];
  buyer: { name: string; email: string };
  busy: boolean;
  error: string | null;
  onSubmit: (attendees: { seatId: string; values: Values }[]) => void;
}) {
  const [values, setValues] = useState<Record<string, Values>>({});
  const set = (seatId: string, fieldId: string, v: string | boolean) =>
    setValues((p) => ({ ...p, [seatId]: { ...p[seatId], [fieldId]: v } }));

  /** "Son mis datos": copia nombre y email del comprador en esa entrada. */
  function useMine(seatId: string, seatFields: AttendeeFieldPublic[]) {
    for (const f of seatFields) {
      if (f.presetKey === "name" && buyer.name) set(seatId, f.id, buyer.name);
      if (f.presetKey === "email" && buyer.email) set(seatId, f.id, buyer.email);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(seats.map((s) => ({ seatId: s.seatId, values: values[s.seatId] ?? {} })));
  }

  const canCopy = fields.some((f) => f.presetKey === "name" || f.presetKey === "email");

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Datos de los asistentes</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
          El organizador pide estos datos para cada entrada. Los campos con * son obligatorios.
        </p>
      </div>

      {seats.map((s, i) => {
        const seatFields = fieldsFor(fields, s.ticketTypeId);
        const v = values[s.seatId] ?? {};
        return (
          <fieldset
            key={s.seatId}
            style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "transparent", margin: 0 }}
          >
            <legend style={{ padding: "0 6px", fontWeight: 600 }}>
              Entrada {i + 1} · {s.label}
            </legend>
            {seatFields.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>Esta entrada no requiere datos.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {i === 0 && canCopy && (buyer.name || buyer.email) && (
                  <button
                    type="button"
                    onClick={() => useMine(s.seatId, seatFields)}
                    style={{ justifySelf: "start", background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontSize: 13 }}
                  >
                    Esta entrada es para mí (usar mis datos)
                  </button>
                )}
                {seatFields.map((f) => (
                  <Field key={f.id} f={f} value={v[f.id]} onChange={(x) => set(s.seatId, f.id, x)} />
                ))}
              </div>
            )}
          </fieldset>
        );
      })}

      {error && <div className="notice error">{error}</div>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Procesando…" : "Continuar al pago"}
      </button>
    </form>
  );
}

function Field({
  f,
  value,
  onChange,
}: {
  f: AttendeeFieldPublic;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const label = (
    <>
      {f.label}
      {f.required && <span style={{ color: "var(--danger)" }}> *</span>}
    </>
  );
  const help = f.helpText && <span style={{ display: "block", fontSize: 12, color: "var(--faint)", marginTop: 4 }}>{f.helpText}</span>;

  if (f.type === "checkbox") {
    return (
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} required={f.required} />
        <span>
          {label}
          {help}
        </span>
      </label>
    );
  }

  const common = {
    value: typeof value === "string" ? value : "",
    required: f.required,
    style: inputStyle,
  };
  let control: React.ReactNode;
  switch (f.type) {
    case "textarea":
      control = <textarea {...common} rows={3} maxLength={2000} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Elige —</option>
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
      break;
    default: {
      const type =
        f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      const autoComplete =
        f.presetKey === "name" ? "name" : f.presetKey === "email" ? "email" : f.presetKey === "phone" ? "tel" : f.presetKey === "birthdate" ? "bday" : f.presetKey === "company" ? "organization" : "off";
      control = (
        <input
          {...common}
          type={type}
          autoComplete={autoComplete}
          maxLength={300}
          placeholder={f.type === "dni" ? "12345678Z o X1234567L" : undefined}
          style={{ ...inputStyle, ...(f.type === "dni" ? { textTransform: "uppercase" } : {}) }}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
  return (
    <label style={{ display: "block", fontSize: 14 }}>
      {label}
      {control}
      {help}
    </label>
  );
}
