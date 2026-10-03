"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  duplicateEvent,
  type EventDetail,
  euros,
  getEvent,
  SHOP_URL,
  setEventStatus,
  type StatusAction,
} from "../lib/api";
import { formatInZone } from "../lib/time";
import EventDetailsForm from "./EventDetailsForm";
import { STATUS_LABEL } from "./EventsList";
import SeatmapEditor from "./SeatmapEditor";
import TicketTypesPanel from "./TicketTypesPanel";

type Tab = "summary" | "details" | "tickets" | "map";

const CONFIRM: Partial<Record<StatusAction, string>> = {
  cancel:
    "¿Cancelar el evento? Es definitivo: deja de venderse y no se puede editar. " +
    "Los reembolsos a quien ya compró se gestionan aparte.",
  close: "¿Cerrar la venta? No se venderán más entradas online (puedes reabrirla).",
  unpublish: "¿Volver a borrador? El evento dejará de verse en la tienda.",
};

export default function EventEditor({
  token,
  eventId,
  slug,
  onBack,
  onOpen,
}: {
  token: string;
  eventId: string;
  slug: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      getEvent(token, eventId)
        .then(setDetail)
        .catch((e) => setError(e.message)),
    [token, eventId],
  );

  useEffect(() => {
    setDetail(null);
    setTab("summary");
    reload();
  }, [reload]);

  if (!detail) return error ? <div className="notice error">{error}</div> : <p className="muted">Cargando…</p>;
  const { event: ev, stats, checklist } = detail;
  const cancelled = ev.status === "CANCELLED";
  const publicUrl = `${SHOP_URL}/${slug}/event/${ev.id}`;

  async function run(action: StatusAction) {
    const confirmText = CONFIRM[action];
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setProblems([]);
    setNotice(null);
    try {
      setDetail(await setEventStatus(token, eventId, action));
      if (action === "publish") setNotice("¡Publicado! El evento ya está a la venta.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      if (e instanceof ApiError) setProblems(e.problems);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    setBusy(true);
    try {
      const copy = await duplicateEvent(token, eventId);
      onOpen(copy.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: "Resumen" },
    { id: "details", label: "Detalles" },
    { id: "tickets", label: `Entradas (${detail.ticketTypes.length})` },
    ...(ev.seatingMode === "RESERVED" ? [{ id: "map" as Tab, label: "Plano" }] : []),
  ];

  return (
    <div>
      <button className="btn link" onClick={onBack}>
        ← eventos
      </button>

      <div className="row" style={{ marginTop: 10 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{ev.name}</h2>
        <span className={`badge ${ev.status}`}>{STATUS_LABEL[ev.status]}</span>
        {ev.visibility === "UNLISTED" && <span className="faint">oculto (solo con enlace)</span>}
      </div>
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>
        {formatInZone(ev.startsAt, ev.timezone)}
        {detail.venue && ` · ${detail.venue.name}`}
      </p>

      <div className="row">
        {ev.status === "DRAFT" && (
          <button className="btn success" disabled={busy} onClick={() => run("publish")}>
            Publicar
          </button>
        )}
        {ev.status === "CLOSED" && (
          <button className="btn success" disabled={busy} onClick={() => run("reopen")}>
            Reabrir venta
          </button>
        )}
        {ev.status === "ON_SALE" && (
          <>
            <a className="btn primary" href={publicUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              Ver en la tienda ↗
            </a>
            <button className="btn" disabled={busy} onClick={() => run("close")}>
              Cerrar venta
            </button>
            <button className="btn" disabled={busy} onClick={() => run("unpublish")}>
              Volver a borrador
            </button>
          </>
        )}
        <button className="btn" disabled={busy} onClick={duplicate}>
          Duplicar
        </button>
        <span className="spacer" />
        {!cancelled && (
          <button className="btn danger" disabled={busy} onClick={() => run("cancel")}>
            Cancelar evento
          </button>
        )}
      </div>

      {notice && <div className="notice ok" style={{ marginTop: 12 }}>{notice}</div>}
      {error && (
        <div className="notice error" style={{ marginTop: 12 }}>
          {error}
          {problems.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {cancelled && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          Evento cancelado: ya no se vende ni se puede editar. Puedes duplicarlo para crear uno nuevo.
        </div>
      )}

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="stack">
          <div className="grid2">
            <Stat label="Vendidas" value={`${stats.sold} / ${stats.capacity}`} />
            <Stat label="Recaudación" value={euros(stats.revenueCents)} />
            <Stat
              label="Ocupación"
              value={stats.capacity ? `${Math.round((stats.sold / stats.capacity) * 100)} %` : "—"}
            />
          </div>

          {(ev.status === "DRAFT" || ev.status === "CLOSED") && (
            <div className="card">
              <h3 className="section-title">Antes de publicar</h3>
              {checklist.length === 0 ? (
                <p className="notice ok" style={{ margin: 0 }}>
                  Todo listo: puedes {ev.status === "DRAFT" ? "publicar" : "reabrir la venta"}.
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--amber)" }}>
                  {checklist.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="card">
            <h3 className="section-title">Ventas por tipo de entrada</h3>
            {detail.ticketTypes.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Aún no hay tipos de entrada.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr className="faint" style={{ textAlign: "left" }}>
                    <th style={{ padding: "4px 0" }}>Tipo</th>
                    <th>Precio actual</th>
                    <th>Vendidas</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.ticketTypes.map((t) => (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 0" }}>{t.name}</td>
                      <td>{t.currentCents === 0 ? "Gratis" : euros(t.currentCents)}</td>
                      <td>
                        {t.sold} / {t.capacity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {ev.status !== "DRAFT" && !cancelled && (
            <div className="card">
              <h3 className="section-title">Enlace público</h3>
              <div className="row">
                <input className="input" readOnly value={publicUrl} style={{ flex: 1 }} />
                <button className="btn" onClick={() => navigator.clipboard?.writeText(publicUrl)}>
                  Copiar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "details" && (
        <EventDetailsForm token={token} detail={detail} disabled={cancelled} onSaved={setDetail} />
      )}
      {tab === "tickets" && (
        <TicketTypesPanel token={token} detail={detail} disabled={cancelled} onChanged={reload} />
      )}
      {tab === "map" && <SeatmapEditor token={token} eventId={eventId} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="faint">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
