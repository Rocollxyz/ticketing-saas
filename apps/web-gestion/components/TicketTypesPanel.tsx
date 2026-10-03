"use client";

import { useState } from "react";
import {
  createTicketType,
  deleteTicketType,
  type EventDetail,
  euros,
  type TicketTypeData,
  type TicketTypeInput,
  updateTicketType,
} from "../lib/api";
import { formatInZone, fromLocalInput, toLocalInput } from "../lib/time";

/** "15,50" / "15.5" / "15" → céntimos; null si no es un importe válido. */
function parseEuros(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
const centsToInput = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

export default function TicketTypesPanel({
  token,
  detail,
  disabled,
  onChanged,
}: {
  token: string;
  detail: EventDetail;
  disabled: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<TicketTypeData | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { event: ev } = detail;
  const general = ev.seatingMode === "GENERAL";
  const tz = ev.timezone;

  async function remove(t: TicketTypeData) {
    if (!window.confirm(`¿Eliminar «${t.name}»?`)) return;
    setError(null);
    try {
      await deleteTicketType(token, ev.id, t.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <p className="muted" style={{ margin: 0, fontSize: 14, flex: 1 }}>
          {general
            ? "Cada tipo de entrada tiene su precio y su aforo."
            : "Crea los tipos de entrada y asígnalos a los asientos en la pestaña «Plano»."}
        </p>
        {!disabled && editing === null && (
          <button className="btn primary" onClick={() => setEditing("new")}>
            + Tipo de entrada
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}

      {editing === "new" && (
        <TicketTypeForm
          general={general}
          tz={tz}
          nextOrder={detail.ticketTypes.length + 1}
          onCancel={() => setEditing(null)}
          onSubmit={async (data) => {
            await createTicketType(token, ev.id, data);
            await onChanged();
            setEditing(null);
          }}
        />
      )}

      {detail.ticketTypes.length === 0 && editing === null && (
        <p className="muted">Aún no hay tipos de entrada. Añade al menos uno para poder vender.</p>
      )}

      {detail.ticketTypes.map((t) =>
        editing !== null && editing !== "new" && editing.id === t.id ? (
          <TicketTypeForm
            key={t.id}
            general={general}
            tz={tz}
            initial={t}
            onCancel={() => setEditing(null)}
            onSubmit={async (data) => {
              await updateTicketType(token, ev.id, t.id, data);
              await onChanged();
              setEditing(null);
            }}
          />
        ) : (
          <div key={t.id} className="card row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 4 }}>
              <div className="row" style={{ gap: 8 }}>
                <strong>{t.name}</strong>
                <span style={{ fontWeight: 600 }}>{t.currentCents === 0 ? "Gratis" : euros(t.currentCents)}</span>
                {t.earlyBird && t.currentCents === t.earlyBird.priceCents && (
                  <span className="faint">
                    anticipada hasta {formatInZone(t.earlyBird.until, tz)} · luego {euros(t.priceCents)}
                  </span>
                )}
              </div>
              {t.description && <span className="muted" style={{ fontSize: 13 }}>{t.description}</span>}
              <span className="faint">
                {t.sold} vendidas de {t.capacity} {general ? "(aforo)" : "asientos"}
                {" · "}
                {t.minPerOrder > 1 && `mín. ${t.minPerOrder} · `}
                {t.maxPerOrder != null ? `máx. ${t.maxPerOrder} por pedido` : "sin máximo propio"}
                {t.salesStartAt && ` · venta desde ${formatInZone(t.salesStartAt, tz)}`}
                {t.salesEndAt && ` · hasta ${formatInZone(t.salesEndAt, tz)}`}
              </span>
            </div>
            {!disabled && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setEditing(t)}>
                  Editar
                </button>
                <button className="btn danger" onClick={() => remove(t)} disabled={t.sold > 0} title={t.sold > 0 ? "Tiene ventas" : ""}>
                  Eliminar
                </button>
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function TicketTypeForm({
  general,
  tz,
  initial,
  nextOrder,
  onSubmit,
  onCancel,
}: {
  general: boolean;
  tz: string;
  initial?: TicketTypeData;
  nextOrder?: number;
  onSubmit: (d: TicketTypeInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [free, setFree] = useState(initial?.priceCents === 0);
  const [price, setPrice] = useState(centsToInput(initial?.priceCents));
  const [capacity, setCapacity] = useState(initial ? String(initial.capacity) : "");
  const [early, setEarly] = useState(!!initial?.earlyBird);
  const [earlyPrice, setEarlyPrice] = useState(centsToInput(initial?.earlyBird?.priceCents));
  const [earlyUntil, setEarlyUntil] = useState(toLocalInput(initial?.earlyBird?.until, tz));
  const [salesStart, setSalesStart] = useState(toLocalInput(initial?.salesStartAt, tz));
  const [salesEnd, setSalesEnd] = useState(toLocalInput(initial?.salesEndAt, tz));
  const [minPer, setMinPer] = useState(String(initial?.minPerOrder ?? 1));
  const [maxPer, setMaxPer] = useState(initial?.maxPerOrder == null ? "" : String(initial.maxPerOrder));
  const [order, setOrder] = useState(String(initial?.sortOrder ?? nextOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const priceCents = free ? 0 : parseEuros(price);
    if (priceCents == null) return setError("Precio inválido (ej.: 25 o 19,90)");
    let earlyBird: TicketTypeInput["earlyBird"] = null;
    if (early && !free) {
      const p = parseEuros(earlyPrice);
      const until = fromLocalInput(earlyUntil, tz);
      if (p == null || !until) return setError("Precio anticipado: indica importe y fecha de fin");
      if (p >= priceCents) return setError("El precio anticipado debería ser menor que el normal");
      earlyBird = { priceCents: p, until };
    }
    if (general && (capacity === "" || Number(capacity) < 0)) return setError("Indica el aforo");

    setBusy(true);
    try {
      await onSubmit({
        name,
        description: description || null,
        priceCents,
        earlyBird,
        ...(general ? { capacity: Number(capacity) } : {}),
        salesStartAt: fromLocalInput(salesStart, tz),
        salesEndAt: fromLocalInput(salesEnd, tz),
        minPerOrder: Number(minPer) || 1,
        maxPerOrder: maxPer === "" ? null : Number(maxPer),
        sortOrder: Number(order) || 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">{initial ? `Editar «${initial.name}»` : "Nuevo tipo de entrada"}</h3>
      <div className="grid2">
        <label className="field">
          Nombre
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="General, VIP, Reducida…"
            autoFocus
          />
        </label>
        <label className="field">
          Precio (€)
          <input
            className="input"
            value={free ? "0" : price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={free}
            inputMode="decimal"
            placeholder="25,00"
          />
          <label className="check" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Gratuita
          </label>
        </label>
        {general && (
          <label className="field">
            Aforo
            <input
              className="input"
              type="number"
              min={initial?.sold ?? 0}
              max={100000}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
            {initial && initial.sold > 0 && <span className="hint">Mínimo {initial.sold} (ya vendidas).</span>}
          </label>
        )}
      </div>
      <label className="field">
        Descripción (opcional)
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="Qué incluye: acceso a zona VIP, consumición…"
        />
      </label>

      {!free && (
        <div className="stack" style={{ gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
            Precio anticipado (early bird)
          </label>
          {early && (
            <div className="grid2">
              <label className="field">
                Precio anticipado (€)
                <input className="input" value={earlyPrice} onChange={(e) => setEarlyPrice(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                Válido hasta
                <input className="input" type="datetime-local" value={earlyUntil} onChange={(e) => setEarlyUntil(e.target.value)} />
                <span className="hint">Después se aplica el precio normal automáticamente.</span>
              </label>
            </div>
          )}
        </div>
      )}

      <details>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 14 }}>
          Opciones avanzadas
        </summary>
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field">
            Venta desde
            <input className="input" type="datetime-local" value={salesStart} onChange={(e) => setSalesStart(e.target.value)} />
            <span className="hint">Vacío: lo que diga el evento.</span>
          </label>
          <label className="field">
            Venta hasta
            <input className="input" type="datetime-local" value={salesEnd} onChange={(e) => setSalesEnd(e.target.value)} />
          </label>
          <label className="field">
            Mínimo por pedido
            <input className="input" type="number" min={1} max={100} value={minPer} onChange={(e) => setMinPer(e.target.value)} />
          </label>
          <label className="field">
            Máximo por pedido
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={maxPer}
              onChange={(e) => setMaxPer(e.target.value)}
              placeholder="Sin límite propio"
            />
          </label>
          <label className="field">
            Orden en la tienda
            <input className="input" type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
          </label>
        </div>
      </details>

      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : initial ? "Guardar" : "Crear"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
