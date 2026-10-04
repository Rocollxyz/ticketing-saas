"use client";

import { useCallback, useEffect, useState } from "react";
import { addSession, type EventDetail, listSessions, type SessionRow } from "../lib/api";
import { formatInZone, fromLocalInput, toLocalInput } from "../lib/time";
import { STATUS_LABEL } from "./EventsList";

/**
 * Funciones de un espectáculo: el mismo evento en varias fechas. Cada función es un
 * evento con su aforo, ventas y estado; al añadir una se copia esta (entradas, precios,
 * plano, huecos y formulario) en la nueva fecha, en borrador. La tienda las agrupa en
 * una sola tarjeta y en la ficha se elige la fecha.
 */
export default function SessionsPanel({
  token,
  detail,
  onOpen,
  onChanged,
}: {
  token: string;
  detail: EventDetail;
  onOpen: (id: string) => void;
  /** Al crear la primera función el evento pasa a tener serie: se recarga. */
  onChanged: () => void;
}) {
  const ev = detail.event;
  const tz = ev.timezone;
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(
    () =>
      listSessions(token, ev.id)
        .then((r) => setRows(r.sessions))
        .catch((e) => setMsg({ ok: false, text: e.message })),
    [token, ev.id],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // Propuesta: un día después de la última función, a la misma hora.
  useEffect(() => {
    const last = rows?.map((r) => r.startsAt).filter(Boolean).sort().pop() ?? ev.startsAt;
    if (last) setWhen(toLocalInput(new Date(new Date(last).getTime() + 86_400_000).toISOString(), tz));
  }, [rows, ev.startsAt, tz]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = fromLocalInput(when, tz);
    if (!startsAt) return;
    setBusy(true);
    setMsg(null);
    try {
      await addSession(token, ev.id, startsAt);
      await reload();
      if (!ev.seriesId) onChanged();
      setMsg({ ok: true, text: `Función del ${formatInZone(startsAt, tz)} creada en borrador. Ábrela para revisarla y publicarla.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        ¿El mismo espectáculo en varias fechas? Añade funciones: cada una copia las entradas, precios, plano y
        formulario de esta, con su propio aforo y ventas. En la tienda se ve como un solo evento con «Elige función».
      </p>

      {!ev.startsAt && <div className="notice warn">Pon primero la fecha de este evento en «Detalles».</div>}

      {rows && rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "10px 14px" }}>Fecha</th>
                <th style={{ padding: "10px 14px" }}>Estado</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Vendidas</th>
                <th style={{ padding: "10px 14px" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: r.id === ev.id ? 600 : undefined }}>
                    {formatInZone(r.startsAt, tz)}
                    {r.id === ev.id && <span className="muted"> · esta</span>}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    {r.sold} / {r.capacity}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    {r.id !== ev.id && (
                      <button type="button" className="btn" onClick={() => onOpen(r.id)}>
                        Abrir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ev.status !== "CANCELLED" && ev.startsAt && (
        <form className="card row" onSubmit={add} style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ margin: 0 }}>
            Nueva función
            <input
              className="input"
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={busy || !when}>
            {busy ? "Creando…" : "Añadir función"}
          </button>
        </form>
      )}

      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}
