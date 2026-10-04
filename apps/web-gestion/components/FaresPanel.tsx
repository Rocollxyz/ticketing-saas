"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type CouponKind,
  createFare,
  deleteFare,
  euros,
  type EventDetail,
  type Fare,
  type FareInput,
  farePrice,
  listFares,
  updateFare,
} from "../lib/api";

/** Ejemplos habituales en teatros y auditorios, para empezar con un clic. */
const PRESETS: { name: string; requirement: string; kind: CouponKind; value: number }[] = [
  { name: "Jubilado", requirement: "Mayores de 65: presentar DNI en la entrada", kind: "PERCENT", value: 20 },
  { name: "Estudiante", requirement: "Presentar carné de estudiante en vigor", kind: "PERCENT", value: 20 },
  { name: "Infantil", requirement: "Menores de 12 años", kind: "PERCENT", value: 50 },
  { name: "Desempleado", requirement: "Presentar tarjeta de demandante de empleo", kind: "PERCENT", value: 30 },
  { name: "Familia numerosa", requirement: "Presentar el título de familia numerosa", kind: "PERCENT", value: 20 },
  { name: "Diversidad funcional", requirement: "Presentar certificado de discapacidad", kind: "PERCENT", value: 30 },
];

/**
 * Tarifas del evento: precios reducidos (jubilado, estudiante…) que el comprador elige
 * por entrada sobre la misma butaca o plaza. La general es el precio de la categoría; la
 * tarifa lo rebaja un % o un importe. El requisito sale en la entrada y al validarla.
 */
export default function FaresPanel({
  token,
  detail,
  disabled,
}: {
  token: string;
  detail: EventDetail;
  disabled: boolean;
}) {
  const ev = detail.event;
  const [fares, setFares] = useState<Fare[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [preset, setPreset] = useState<FareInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      listFares(token, ev.id)
        .then(setFares)
        .catch((e) => setError(e.message)),
    [token, ev.id],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      return false;
    }
  }

  if (!fares) return null;
  const typeName = (id: string) => detail.ticketTypes.find((t) => t.id === id)?.name ?? "¿?";
  const describe = (f: Pick<Fare, "kind" | "value">) => (f.kind === "PERCENT" ? `−${f.value} %` : `−${euros(f.value)}`);
  /** Precio resultante en cada categoría a la que se aplica: «Platea 16 € · Anfiteatro 12 €». */
  const examples = (f: Fare) =>
    detail.ticketTypes
      .filter((t) => !f.ticketTypeIds?.length || f.ticketTypeIds.includes(t.id))
      .filter((t) => t.currentCents != null)
      .map((t) => `${t.name} ${euros(farePrice(t.currentCents!, f))}`)
      .join(" · ");
  const unused = PRESETS.filter((p) => !fares.some((f) => f.name.toLowerCase() === p.name.toLowerCase()));

  return (
    <div className="card stack">
      <div className="row">
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Tarifas</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
            Precios reducidos que el comprador elige <strong>por entrada</strong> (sobre la misma butaca o plaza). Sin
            tarifas, todas las entradas van al precio de su categoría («General»).
          </p>
        </div>
        {!disabled && editing !== "new" && (
          <button
            className="btn"
            onClick={() => {
              setPreset(null);
              setEditing("new");
            }}
          >
            + Nueva tarifa
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}

      {!disabled && editing !== "new" && unused.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="faint">Añadir rápido:</span>
          {unused.map((p) => (
            <button
              key={p.name}
              type="button"
              className="btn"
              style={{ padding: "4px 10px", fontSize: 13 }}
              onClick={() => {
                setPreset(p);
                setEditing("new");
              }}
            >
              {p.name} {describe(p)}
            </button>
          ))}
        </div>
      )}

      {editing === "new" && (
        <FareForm
          detail={detail}
          initial={preset ?? undefined}
          onCancel={() => setEditing(null)}
          onSave={(d) => run(() => createFare(token, ev.id, d)).then((ok) => ok && setEditing(null))}
        />
      )}

      {fares.map((f) =>
        editing === f.id ? (
          <FareForm
            key={f.id}
            detail={detail}
            initial={f}
            onCancel={() => setEditing(null)}
            onSave={(d) => run(() => updateFare(token, ev.id, f.id, d)).then((ok) => ok && setEditing(null))}
          />
        ) : (
          <div key={f.id} className="row" style={{ opacity: f.active ? 1 : 0.6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 2 }}>
              <span>
                <strong>{f.name}</strong>
                <span className="muted"> · {describe(f)}</span>
                {!f.active && <span className="faint"> · desactivada</span>}
              </span>
              <span className="faint">
                {examples(f) || "Sin categorías con precio"}
                {f.ticketTypeIds?.length ? ` (solo ${f.ticketTypeIds.map(typeName).join(", ")})` : ""}
              </span>
              {f.requirement && <span className="faint">Requisito: {f.requirement}</span>}
              {f.sold > 0 && <span className="faint">{f.sold} {f.sold === 1 ? "vendida" : "vendidas"}</span>}
            </div>
            {!disabled && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setEditing(f.id)}>
                  Editar
                </button>
                <button className="btn" onClick={() => run(() => updateFare(token, ev.id, f.id, { active: !f.active }))}>
                  {f.active ? "Desactivar" : "Activar"}
                </button>
                {f.sold === 0 && (
                  <button
                    className="btn danger"
                    onClick={() => window.confirm(`¿Borrar la tarifa «${f.name}»?`) && run(() => deleteFare(token, ev.id, f.id))}
                  >
                    Borrar
                  </button>
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function FareForm({
  detail,
  initial,
  onSave,
  onCancel,
}: {
  detail: EventDetail;
  initial?: FareInput;
  onSave: (d: FareInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [requirement, setRequirement] = useState(initial?.requirement ?? "");
  const [kind, setKind] = useState<CouponKind>(initial?.kind ?? "PERCENT");
  // En importe fijo se edita en euros; la API trabaja en céntimos.
  const [value, setValue] = useState(
    initial?.value != null ? String(initial.kind === "AMOUNT" ? initial.value / 100 : initial.value) : "",
  );
  const [types, setTypes] = useState<string[]>(initial?.ticketTypeIds ?? []);
  const [busy, setBusy] = useState(false);
  const isEdit = initial && "id" in initial;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const n = Number(value.replace(",", "."));
    await onSave({
      name,
      requirement: requirement.trim() || null,
      kind,
      value: kind === "AMOUNT" ? Math.round(n * 100) : Math.round(n),
      ticketTypeIds: types.length === 0 ? null : types,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">{isEdit ? `Editar «${initial?.name}»` : "Nueva tarifa"}</h3>
      <div className="grid2">
        <label className="field">
          Nombre
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            placeholder="Jubilado"
            autoFocus
          />
        </label>
        <div className="field">
          Rebaja sobre el precio de la entrada
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input
              className="input"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CouponKind)} style={{ width: "auto" }}>
              <option value="PERCENT">%</option>
              <option value="AMOUNT">€</option>
            </select>
          </div>
          <span className="hint">Se aplica al precio vigente (también al anticipado). 100 % = gratis.</span>
        </div>
      </div>
      <label className="field">
        Requisito
        <input
          className="input"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          maxLength={200}
          placeholder="Presentar DNI en la entrada"
        />
        <span className="hint">Lo ve el comprador al elegirla, sale en la entrada y al validarla en la puerta.</span>
      </label>
      {detail.ticketTypes.length > 1 && (
        <div className="field">
          Solo para estas entradas
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
          <span className="hint">Sin marcar ninguna: todas.</span>
        </div>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : isEdit ? "Guardar" : "Crear tarifa"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
