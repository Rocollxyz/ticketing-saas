"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AttendeeField,
  type AttendeeFieldInput,
  type AttendeeFieldType,
  createAttendeeField,
  deleteAttendeeField,
  type EventDetail,
  listAttendeeFields,
  reorderAttendeeFields,
  updateAttendeeField,
} from "../lib/api";

/** Campos estándar (mismas claves que la API). */
const PRESETS: { key: string; label: string }[] = [
  { key: "name", label: "Nombre y apellidos" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Teléfono" },
  { key: "company", label: "Empresa" },
  { key: "job", label: "Cargo" },
  { key: "dni", label: "DNI / NIE" },
  { key: "birthdate", label: "Fecha de nacimiento" },
];

const TYPE_LABEL: Record<AttendeeFieldType, string> = {
  text: "Texto corto",
  textarea: "Texto largo",
  email: "Email",
  phone: "Teléfono",
  number: "Número",
  select: "Desplegable",
  checkbox: "Casilla (sí/no)",
  date: "Fecha",
  dni: "DNI / NIE",
};

/**
 * Formulario de asistentes: qué datos se piden por CADA entrada. Las respuestas se
 * guardan en la entrada; cambiar el formulario no altera las ventas anteriores.
 */
export default function AttendeeFieldsPanel({
  token,
  detail,
  disabled,
}: {
  token: string;
  detail: EventDetail;
  disabled: boolean;
}) {
  const eventId = detail.event.id;
  const [fields, setFields] = useState<AttendeeField[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      listAttendeeFields(token, eventId)
        .then(setFields)
        .catch((e) => setError(e.message)),
    [token, eventId],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  if (!fields) return <p className="muted">Cargando…</p>;
  const used = new Set(fields.map((f) => f.presetKey).filter(Boolean));
  const typeName = (id: string) => detail.ticketTypes.find((t) => t.id === id)?.name ?? "¿?";

  function move(i: number, dir: -1 | 1) {
    const ids = fields!.map((f) => f.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    void run(() => reorderAttendeeFields(token, eventId, ids));
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Datos que pedirás por <strong>cada entrada</strong> al comprar (después de reservar y antes de pagar).
        Útil para entradas nominativas, listas de acreditación o tallas de camiseta. Sin campos, solo se pide el
        email del comprador.
      </p>
      {error && <div className="notice error">{error}</div>}

      {!disabled && (
        <div className="card stack" style={{ gap: 8 }}>
          <span className="faint">Añadir un campo estándar</span>
          <div className="row" style={{ gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className="btn"
                disabled={used.has(p.key)}
                onClick={() => run(() => createAttendeeField(token, eventId, { presetKey: p.key, required: p.key === "name" }))}
              >
                + {p.label}
              </button>
            ))}
            <button className="btn primary" onClick={() => setEditing("new")}>
              + Campo personalizado
            </button>
          </div>
        </div>
      )}

      {editing === "new" && (
        <FieldForm
          detail={detail}
          onCancel={() => setEditing(null)}
          onSave={(d) => run(() => createAttendeeField(token, eventId, d)).then(() => setEditing(null))}
        />
      )}

      {fields.length === 0 && editing !== "new" && (
        <p className="muted">Este evento no pide datos de los asistentes.</p>
      )}

      {fields.map((f, i) =>
        editing === f.id ? (
          <FieldForm
            key={f.id}
            detail={detail}
            initial={f}
            onCancel={() => setEditing(null)}
            onSave={(d) => run(() => updateAttendeeField(token, eventId, f.id, d)).then(() => setEditing(null))}
          />
        ) : (
          <div key={f.id} className="card row" style={{ alignItems: "center" }}>
            {!disabled && (
              <div style={{ display: "grid", gap: 2 }}>
                <button className="btn link" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                  ▲
                </button>
                <button className="btn link" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                  ▼
                </button>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 2 }}>
              <span>
                <strong>{f.label}</strong>
                {f.required && <span style={{ color: "var(--red)" }}> *</span>}
                <span className="faint"> · {TYPE_LABEL[f.type]}</span>
              </span>
              <span className="faint">
                {f.ticketTypeIds?.length ? `Solo: ${f.ticketTypeIds.map(typeName).join(", ")}` : "Todas las entradas"}
                {f.showOnTicket && " · se imprime en la entrada"}
                {f.type === "select" && f.options && ` · opciones: ${f.options.join(", ")}`}
              </span>
            </div>
            {!disabled && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setEditing(f.id)}>
                  Editar
                </button>
                <button
                  className="btn danger"
                  onClick={() =>
                    window.confirm(`¿Quitar «${f.label}» del formulario? Las respuestas ya recogidas se conservan.`) &&
                    run(() => deleteAttendeeField(token, eventId, f.id))
                  }
                >
                  Quitar
                </button>
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function FieldForm({
  detail,
  initial,
  onSave,
  onCancel,
}: {
  detail: EventDetail;
  initial?: AttendeeField;
  onSave: (d: AttendeeFieldInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [type, setType] = useState<AttendeeFieldType>(initial?.type ?? "text");
  const [required, setRequired] = useState(initial?.required ?? false);
  const [helpText, setHelpText] = useState(initial?.helpText ?? "");
  const [options, setOptions] = useState((initial?.options ?? []).join("\n"));
  const [types, setTypes] = useState<string[]>(initial?.ticketTypeIds ?? []);
  const [onTicket, setOnTicket] = useState(initial?.showOnTicket ?? false);
  const [busy, setBusy] = useState(false);
  const preset = initial?.presetKey;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave({
      label,
      ...(preset ? {} : { type }), // un campo estándar conserva su tipo
      required,
      helpText: helpText || null,
      options: type === "select" ? options.split("\n").map((o) => o.trim()).filter(Boolean) : null,
      ticketTypeIds: types.length ? types : null,
      showOnTicket: onTicket,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">{initial ? `Editar «${initial.label}»` : "Nuevo campo"}</h3>
      <div className="grid2">
        <label className="field">
          Pregunta / etiqueta
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} autoFocus />
        </label>
        <label className="field">
          Tipo de respuesta
          <select
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as AttendeeFieldType)}
            disabled={!!preset}
          >
            {(Object.keys(TYPE_LABEL) as AttendeeFieldType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {type === "select" && (
        <label className="field">
          Opciones (una por línea)
          <textarea className="textarea" value={options} onChange={(e) => setOptions(e.target.value)} rows={4} required />
        </label>
      )}
      <label className="field">
        Texto de ayuda (opcional)
        <input
          className="input"
          value={helpText}
          onChange={(e) => setHelpText(e.target.value)}
          maxLength={200}
          placeholder="Ej.: tal como aparece en tu documento"
        />
      </label>
      {detail.ticketTypes.length > 1 && (
        <div className="field">
          Pedirlo en
          <div className="row" style={{ gap: 12 }}>
            {detail.ticketTypes.map((t) => (
              <label key={t.id} className="check">
                <input
                  type="checkbox"
                  checked={types.includes(t.id)}
                  onChange={(e) => setTypes((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
                />
                {t.name}
              </label>
            ))}
          </div>
          <span className="hint">Sin marcar ninguna: en todas las entradas.</span>
        </div>
      )}
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Obligatorio
        </label>
        <label className="check">
          <input type="checkbox" checked={onTicket} onChange={(e) => setOnTicket(e.target.checked)} /> Imprimir en la entrada
        </label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : initial ? "Guardar" : "Añadir"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
