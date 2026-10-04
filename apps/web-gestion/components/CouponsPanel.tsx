"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type Coupon,
  type CouponInput,
  type CouponKind,
  createCoupon,
  deleteCoupon,
  euros,
  type EventDetail,
  listCoupons,
  updateCoupon,
} from "../lib/api";
import { formatInZone, fromLocalInput, toLocalInput } from "../lib/time";

/**
 * Códigos de descuento que valen para este evento: los propios del evento y los que el
 * promotor creó para todos sus eventos. El descuento se aplica a cada entrada elegible.
 */
export default function CouponsPanel({
  token,
  detail,
  disabled,
}: {
  token: string;
  detail: EventDetail;
  disabled: boolean;
}) {
  const ev = detail.event;
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      listCoupons(token, ev.id)
        .then(setCoupons)
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

  if (!coupons) return <p className="muted">Cargando…</p>;
  const typeName = (id: string) => detail.ticketTypes.find((t) => t.id === id)?.name ?? "¿?";
  const describe = (c: Coupon) => (c.kind === "PERCENT" ? `${c.value} %` : `${euros(c.value)}`) + " por entrada";

  return (
    <div className="stack">
      <div className="row">
        <p className="muted" style={{ margin: 0, fontSize: 14, flex: 1 }}>
          El comprador escribe el código antes de pagar. El descuento se aplica a <strong>cada entrada</strong> del
          pedido que cumpla las condiciones.
        </p>
        {!disabled && editing !== "new" && (
          <button className="btn primary" onClick={() => setEditing("new")}>
            + Nuevo código
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}

      {editing === "new" && (
        <CouponForm
          detail={detail}
          onCancel={() => setEditing(null)}
          onSave={(d) => run(() => createCoupon(token, d)).then((ok) => ok && setEditing(null))}
        />
      )}

      {coupons.length === 0 && editing !== "new" && <p className="muted">Este evento no tiene códigos de descuento.</p>}

      {coupons.map((c) =>
        editing === c.id ? (
          <CouponForm
            key={c.id}
            detail={detail}
            initial={c}
            onCancel={() => setEditing(null)}
            onSave={(d) => run(() => updateCoupon(token, c.id, d)).then((ok) => ok && setEditing(null))}
          />
        ) : (
          <div key={c.id} className="card row" style={{ opacity: c.active ? 1 : 0.6 }}>
            <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 2 }}>
              <span>
                <code style={{ fontSize: 15, fontWeight: 600 }}>{c.code}</code>
                <span className="muted"> · {describe(c)}</span>
                {!c.active && <span className="faint"> · desactivado</span>}
              </span>
              <span className="faint">
                {c.eventId ? "Solo este evento" : "Todos tus eventos"}
                {c.ticketTypeIds?.length ? ` · solo ${c.ticketTypeIds.map(typeName).join(", ")}` : ""}
                {c.validFrom && ` · desde ${formatInZone(c.validFrom, ev.timezone)}`}
                {c.validTo && ` · hasta ${formatInZone(c.validTo, ev.timezone)}`}
              </span>
              <span className="faint">
                Usado {c.uses}
                {c.maxUses != null ? ` de ${c.maxUses}` : ""} {c.uses === 1 ? "vez" : "veces"}
                {c.discountedCents > 0 && ` · ${euros(c.discountedCents)} descontados`}
              </span>
            </div>
            {!disabled && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setEditing(c.id)}>
                  Editar
                </button>
                <button className="btn" onClick={() => run(() => updateCoupon(token, c.id, { active: !c.active }))}>
                  {c.active ? "Desactivar" : "Activar"}
                </button>
                {c.uses === 0 && (
                  <button
                    className="btn danger"
                    onClick={() =>
                      window.confirm(`¿Borrar el código «${c.code}»?`) && run(() => deleteCoupon(token, c.id))
                    }
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

function CouponForm({
  detail,
  initial,
  onSave,
  onCancel,
}: {
  detail: EventDetail;
  initial?: Coupon;
  onSave: (d: CouponInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const tz = detail.event.timezone;
  const [code, setCode] = useState(initial?.code ?? "");
  const [kind, setKind] = useState<CouponKind>(initial?.kind ?? "PERCENT");
  // En importe fijo se edita en euros; la API trabaja en céntimos.
  const [value, setValue] = useState(
    initial ? String(initial.kind === "AMOUNT" ? initial.value / 100 : initial.value) : "",
  );
  const [allEvents, setAllEvents] = useState(initial ? initial.eventId === null : false);
  const [types, setTypes] = useState<string[]>(initial?.ticketTypeIds ?? []);
  const [maxUses, setMaxUses] = useState(initial?.maxUses != null ? String(initial.maxUses) : "");
  const [from, setFrom] = useState(toLocalInput(initial?.validFrom, tz));
  const [to, setTo] = useState(toLocalInput(initial?.validTo, tz));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const n = Number(value.replace(",", "."));
    await onSave({
      code,
      kind,
      value: kind === "AMOUNT" ? Math.round(n * 100) : Math.round(n),
      eventId: allEvents ? null : detail.event.id,
      ticketTypeIds: allEvents || types.length === 0 ? null : types,
      maxUses: maxUses ? Number(maxUses) : null,
      validFrom: from ? fromLocalInput(from, tz) : null,
      validTo: to ? fromLocalInput(to, tz) : null,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">{initial ? `Editar «${initial.code}»` : "Nuevo código de descuento"}</h3>
      <div className="grid2">
        <label className="field">
          Código
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
            required
            minLength={3}
            maxLength={40}
            placeholder="VERANO10"
            autoFocus
          />
          <span className="hint">Letras, números y guiones. No distingue mayúsculas.</span>
        </label>
        <div className="field">
          Descuento por entrada
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
          <span className="hint">{kind === "PERCENT" ? "100 % = entradas gratis." : "Nunca deja una entrada por debajo de 0 €."}</span>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} /> Válido en todos
        mis eventos
      </label>

      {!allEvents && detail.ticketTypes.length > 1 && (
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

      <div className="grid2">
        <label className="field">
          Usos máximos
          <input
            className="input"
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Sin límite"
          />
          <span className="hint">Cada pedido cuenta como un uso.</span>
        </label>
        <label className="field">
          Válido desde
          <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Válido hasta
          <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : initial ? "Guardar" : "Crear código"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
