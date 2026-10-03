"use client";

import { useEffect, useState } from "react";
import { createEvent, euros, listEvents, type PromoterEvent, type SeatingMode } from "../lib/api";
import { formatInZone } from "../lib/time";

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  ON_SALE: "A la venta",
  CLOSED: "Venta cerrada",
  CANCELLED: "Cancelado",
};

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "ON_SALE", label: "A la venta" },
  { id: "DRAFT", label: "Borradores" },
  { id: "CLOSED", label: "Cerrados" },
  { id: "CANCELLED", label: "Cancelados" },
] as const;

export default function EventsList({
  token,
  onOpen,
  onAuthError,
}: {
  token: string;
  onOpen: (id: string) => void;
  onAuthError: () => void;
}) {
  const [events, setEvents] = useState<PromoterEvent[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listEvents(token)
      .then(setEvents)
      .catch((e) => {
        if (e.status === 401) onAuthError();
        else setError(e.message);
      });
  }, [token, onAuthError]);

  const shown = (events ?? []).filter((e) => filter === "all" || e.status === filter);

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Tus eventos</h2>
        <span className="spacer" />
        {!creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Nuevo evento
          </button>
        )}
      </div>

      {creating && <NewEventForm token={token} onCreated={onOpen} onCancel={() => setCreating(false)} />}
      {error && <div className="notice error">{error}</div>}

      <div className="tabs" style={{ margin: "4px 0" }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`tab ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
            {events && f.id !== "all" && ` (${events.filter((e) => e.status === f.id).length})`}
          </button>
        ))}
      </div>

      {!events && <p className="muted">Cargando…</p>}
      {events && shown.length === 0 && (
        <p className="muted">
          {events.length === 0 ? "Todavía no tienes eventos. Crea el primero." : "No hay eventos en este filtro."}
        </p>
      )}

      {shown.map((e) => {
        const pct = e.capacity ? Math.round((e.sold / e.capacity) * 100) : 0;
        return (
          <button
            key={e.id}
            onClick={() => onOpen(e.id)}
            className="card row"
            style={{ textAlign: "left", cursor: "pointer", color: "inherit", alignItems: "stretch" }}
          >
            <div
              style={{
                width: 88,
                minHeight: 64,
                borderRadius: 8,
                background: e.imageUrl ? `center/cover url("${e.imageUrl}")` : "var(--card-2)",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 4 }}>
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: 16 }}>{e.name}</strong>
                <span className={`badge ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                {e.visibility === "UNLISTED" && <span className="faint">· oculto</span>}
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                {formatInZone(e.startsAt, e.timezone)}
                {e.venueName && ` · ${e.venueName}`}
                {" · "}
                {e.seatingMode === "GENERAL" ? "Entrada general" : "Numerado"}
              </span>
            </div>
            <div style={{ width: 170, display: "grid", gap: 6, alignContent: "center" }}>
              <span style={{ fontSize: 13 }}>
                {e.sold} / {e.capacity} vendidas
              </span>
              <div className="meter">
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="faint">{euros(e.revenueCents)} recaudado</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NewEventForm({
  token,
  onCreated,
  onCancel,
}: {
  token: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SeatingMode>("GENERAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ev = await createEvent(token, { name, seatingMode: mode });
      onCreated(ev.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h3 className="section-title">Nuevo evento</h3>
      <label className="field">
        Nombre del evento
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </label>
      <div className="field">
        Tipo de aforo
        <div className="grid2">
          <ModeOption
            checked={mode === "GENERAL"}
            onChange={() => setMode("GENERAL")}
            title="Entrada general"
            text="Sin asientos asignados: aforo por tipo de entrada (conciertos de pie, festivales, fiestas…)."
          />
          <ModeOption
            checked={mode === "RESERVED"}
            onChange={() => setMode("RESERVED")}
            title="Asientos numerados"
            text="El comprador elige su butaca en el plano (teatros, auditorios…)."
          />
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? "Creando…" : "Crear borrador"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <span className="faint">Después completarás fecha, recinto y entradas.</span>
      </div>
    </form>
  );
}

export function ModeOption({
  checked,
  onChange,
  title,
  text,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  text: string;
  disabled?: boolean;
}) {
  return (
    <label
      className="card"
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        borderColor: checked ? "var(--accent)" : undefined,
        opacity: disabled && !checked ? 0.5 : 1,
        display: "grid",
        gap: 4,
      }}
    >
      <span className="check">
        <input type="radio" checked={checked} onChange={onChange} disabled={disabled} />
        <strong>{title}</strong>
      </span>
      <span className="faint">{text}</span>
    </label>
  );
}
