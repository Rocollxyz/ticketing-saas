"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AttendeeField,
  downloadTicketsCsv,
  euros,
  type EventDetail,
  type IssuedTicketRow,
  issueManualTickets,
  listAttendeeFields,
  listTickets,
  markRefundDone,
  refundVoidedTicket,
  type RefundStatus,
  resendTicket,
  retryRefund,
  type TicketChannel,
  type TicketFilters,
  type TicketPage,
  type TicketStatus,
  updateTicketAttendee,
  voidTicket,
} from "../lib/api";
import { formatInZone } from "../lib/time";

const STATUS_LABEL: Record<TicketStatus, string> = { ISSUED: "Válida", CHECKED_IN: "Validada", VOID: "Anulada" };
const REFUND_SHORT: Record<RefundStatus, string> = {
  PENDING: "devolviendo…",
  MANUAL: "por devolver en mano",
  SUCCEEDED: "devuelta",
  FAILED: "devolución fallida",
};
const CHANNEL_LABEL: Record<TicketChannel, string> = { online: "Online", taquilla: "Taquilla", invitacion: "Invitación" };

/**
 * Entradas emitidas del evento: buscar, ver y corregir los datos de cada asistente,
 * reenviar por email, anular, emitir invitaciones a mano y exportar a CSV.
 */
export default function TicketsPanel({
  token,
  detail,
  onChanged,
}: {
  token: string;
  detail: EventDetail;
  onChanged: () => void;
}) {
  const ev = detail.event;
  const [filters, setFilters] = useState<TicketFilters>({ q: "", status: "", ticketTypeId: "" });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<TicketPage | null>(null);
  const [fields, setFields] = useState<AttendeeField[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // La búsqueda se lanza al dejar de escribir.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: query.trim() })), 300);
    return () => clearTimeout(t);
  }, [query]);

  const reload = useCallback(
    () =>
      listTickets(token, ev.id, filters)
        .then(setPage)
        .catch((e) => setError(e.message)),
    [token, ev.id, filters],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    listAttendeeFields(token, ev.id).then(setFields).catch(() => setFields([]));
  }, [token, ev.id]);

  async function more() {
    if (!page) return;
    try {
      const next = await listTickets(token, ev.id, filters, page.tickets.length);
      setPage({ ...next, tickets: [...page.tickets, ...next.tickets] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function exportCsv() {
    setError(null);
    try {
      await downloadTicketsCsv(token, ev.id, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  /** Tras una acción: mensaje, recarga del listado y del resumen del evento. */
  async function done(msg: string) {
    setNotice(msg);
    setError(null);
    await reload();
    onChanged();
  }

  const canIssue = ev.status === "ON_SALE" || ev.status === "CLOSED";
  const when = (d: string | null) => (d ? formatInZone(d, ev.timezone) : "—");

  return (
    <div className="stack">
      <div className="row">
        <input
          className="input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Buscar por nombre, email, DNI, nº de entrada o pedido…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select"
          style={{ width: "auto" }}
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as TicketStatus | "" }))}
        >
          <option value="">Todos los estados</option>
          {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {detail.ticketTypes.length > 1 && (
          <select
            className="select"
            style={{ width: "auto" }}
            value={filters.ticketTypeId}
            onChange={(e) => setFilters((f) => ({ ...f, ticketTypeId: e.target.value }))}
          >
            <option value="">Todas las categorías</option>
            {detail.ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={exportCsv} disabled={!page?.total}>
          Exportar CSV
        </button>
        {canIssue && (
          <button className="btn primary" onClick={() => setAdding((a) => !a)}>
            + Añadir entradas
          </button>
        )}
      </div>

      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {adding && (
        <ManualIssueForm
          token={token}
          detail={detail}
          onCancel={() => setAdding(false)}
          onDone={(msg) => {
            setAdding(false);
            void done(msg);
          }}
        />
      )}

      {!page ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <p className="faint" style={{ margin: 0 }}>
            {page.counts.issued} válidas · {page.counts.checkedIn} validadas en el acceso · {page.counts.void} anuladas
            {(filters.q || filters.status || filters.ticketTypeId) && ` · ${page.total} con estos filtros`}
          </p>
          {page.tickets.length === 0 ? (
            <p className="muted">
              {filters.q || filters.status || filters.ticketTypeId
                ? "Ninguna entrada coincide con la búsqueda."
                : "Aún no hay entradas emitidas."}
            </p>
          ) : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Plaza</th>
                    <th>Titular</th>
                    <th>Comprador</th>
                    <th>Canal</th>
                    <th>Estado</th>
                    <th>Emitida</th>
                  </tr>
                </thead>
                <tbody>
                  {page.tickets.map((t) => (
                    <TicketRows
                      key={t.id}
                      t={t}
                      open={selected === t.id}
                      onToggle={() => setSelected((s) => (s === t.id ? null : t.id))}
                      when={when}
                    >
                      <TicketDetail
                        token={token}
                        eventId={ev.id}
                        ticket={t}
                        fields={fields}
                        when={when}
                        onDone={done}
                        onError={setError}
                      />
                    </TicketRows>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.tickets.length < page.total && (
            <button className="btn" onClick={more} style={{ justifySelf: "start" }}>
              Cargar más ({page.total - page.tickets.length} restantes)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TicketRows({
  t,
  open,
  onToggle,
  when,
  children,
}: {
  t: IssuedTicketRow;
  open: boolean;
  onToggle: () => void;
  when: (d: string | null) => string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className={`clickable ${open ? "selected" : ""}`} onClick={onToggle}>
        <td>
          {t.seat}
          {!t.isGeneral && t.categoria && <div className="faint">{t.categoria}</div>}
        </td>
        <td>{t.attendeeName ?? <span className="faint">—</span>}</td>
        <td>
          {t.buyerName ?? t.buyerEmail ?? <span className="faint">—</span>}
          {t.buyerName && t.buyerEmail && <div className="faint">{t.buyerEmail}</div>}
        </td>
        <td>
          {CHANNEL_LABEL[t.channel]}
          {t.couponCode && <div className="faint">{t.couponCode}</div>}
        </td>
        <td>
          <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span>
          {t.refund && <div className="faint">{REFUND_SHORT[t.refund.status]}</div>}
        </td>
        <td className="faint" style={{ fontSize: 13 }}>
          {when(t.createdAt)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: "var(--bg)" }}>
            {children}
          </td>
        </tr>
      )}
    </>
  );
}

function TicketDetail({
  token,
  eventId,
  ticket: t,
  fields,
  when,
  onDone,
  onError,
}: {
  token: string;
  eventId: string;
  ticket: IssuedTicketRow;
  fields: AttendeeField[];
  when: (d: string | null) => string;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "resend" | "void" | "refund">("view");
  const [busy, setBusy] = useState(false);
  const applicable = fields.filter(
    (f) => !f.ticketTypeIds?.length || (t.ticketTypeId != null && f.ticketTypeIds.includes(t.ticketTypeId)),
  );
  const isVoid = t.status === "VOID";
  const refundable = canRefund(t);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    onError(null);
    try {
      const msg = await fn();
      setMode("view");
      await onDone(msg);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ padding: "6px 4px" }}>
      <div className="grid2" style={{ fontSize: 13 }}>
        <div>
          <div className="faint">Entrada</div>
          <code>{t.id}</code>
        </div>
        <div>
          <div className="faint">Pedido</div>
          <code>{t.orderId}</code>
        </div>
        <div>
          <div className="faint">Validada en el acceso</div>
          {when(t.checkedInAt)}
        </div>
        <div>
          <div className="faint">Pagado</div>
          {t.channel === "invitacion" ? "Invitación" : t.priceCents == null ? "— (venta anterior)" : euros(t.priceCents)}
          {t.couponCode && <span className="faint"> · código {t.couponCode}</span>}
        </div>
      </div>

      {t.refund && (
        <div className={`notice ${REFUND_NOTICE[t.refund.status]}`}>
          {REFUND_TEXT[t.refund.status](euros(t.refund.amountCents))}
          {t.refund.error && <div style={{ fontSize: 13, marginTop: 4 }}>Motivo: {t.refund.error}</div>}
          {t.refund.status === "FAILED" && (
            <button
              className="btn"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await retryRefund(token, eventId, t.refund!.id);
                  return "Devolución enviada de nuevo a la pasarela.";
                })
              }
            >
              Reintentar
            </button>
          )}
          {t.refund.status === "MANUAL" && (
            <button
              className="btn"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() =>
                window.confirm(`¿Confirmas que has devuelto ${euros(t.refund!.amountCents)} al comprador?`) &&
                run(async () => {
                  await markRefundDone(token, eventId, t.refund!.id);
                  return "Devolución marcada como hecha.";
                })
              }
            >
              Marcar como devuelto
            </button>
          )}
        </div>
      )}

      {mode === "edit" ? (
        <AttendeeEditForm
          fields={applicable}
          answers={t.attendee}
          busy={busy}
          onCancel={() => setMode("view")}
          onSave={(values) =>
            run(async () => {
              await updateTicketAttendee(token, eventId, t.id, values);
              return "Datos del asistente guardados.";
            })
          }
        />
      ) : (
        <div>
          <div className="faint" style={{ marginBottom: 4 }}>
            Datos del asistente
          </div>
          {t.attendee.length === 0 ? (
            <span className="muted" style={{ fontSize: 14 }}>
              Sin datos.
            </span>
          ) : (
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", fontSize: 14 }}>
              {t.attendee.map((a) => (
                <div key={a.fieldId} style={{ display: "contents" }}>
                  <dt className="muted">{a.label}</dt>
                  <dd style={{ margin: 0 }}>{a.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {mode === "resend" && (
        <ResendForm
          defaultTo={t.buyerEmail ?? t.attendee.find((a) => a.preset === "email")?.value ?? ""}
          busy={busy}
          onCancel={() => setMode("view")}
          onSend={(to, wholeOrder) =>
            run(async () => {
              const r = await resendTicket(token, eventId, t.id, { to, wholeOrder });
              return `Se enviará${r.count > 1 ? `n ${r.count} entradas` : " la entrada"} a ${r.to} en unos segundos.`;
            })
          }
        />
      )}

      {mode === "void" && (
        <VoidForm
          ticket={t}
          busy={busy}
          onCancel={() => setMode("view")}
          onVoid={(release, reason, refund) =>
            run(async () => {
              const r = await voidTicket(token, eventId, t.id, { release, reason, ...refund });
              const what = r.voided > 1 ? `${r.voided} entradas anuladas` : "Entrada anulada";
              return (
                (release ? `${what}; plazas de nuevo a la venta.` : `${what} (las plazas siguen bloqueadas).`) +
                (r.refund ? ` ${REFUND_TEXT[r.refund.status](euros(r.refund.amountCents))}` : "")
              );
            })
          }
        />
      )}

      {mode === "refund" && (
        <RefundForm
          ticket={t}
          busy={busy}
          onCancel={() => setMode("view")}
          onRefund={(refundCents, reason) =>
            run(async () => {
              const r = await refundVoidedTicket(token, eventId, t.id, { refundCents, reason });
              return REFUND_TEXT[r.status](euros(r.amountCents));
            })
          }
        />
      )}

      {mode === "view" && isVoid && !t.refund && refundable && (
        <div className="row">
          <button className="btn" onClick={() => setMode("refund")}>
            Devolver el dinero
          </button>
        </div>
      )}

      {mode === "view" && !isVoid && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" onClick={() => setMode("edit")} disabled={applicable.length === 0}>
            Editar asistente
          </button>
          <button className="btn" onClick={() => setMode("resend")}>
            Reenviar
          </button>
          <span className="spacer" />
          <button className="btn danger" onClick={() => setMode("void")}>
            Anular
          </button>
        </div>
      )}
      {mode === "view" && !isVoid && applicable.length === 0 && (
        <span className="faint">Para editar datos del asistente, añade campos en la pestaña «Formulario».</span>
      )}
    </div>
  );
}

function AttendeeEditForm({
  fields,
  answers,
  busy,
  onSave,
  onCancel,
}: {
  fields: AttendeeField[];
  answers: IssuedTicketRow["attendee"];
  busy: boolean;
  onSave: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const v = answers.find((a) => a.fieldId === f.id)?.value ?? "";
        return [f.id, f.type === "checkbox" ? v === "Sí" : v];
      }),
    ),
  );
  const set = (id: string, v: string | boolean) => setValues((p) => ({ ...p, [id]: v }));

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <div className="grid2">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <label key={f.id} className="check">
              <input type="checkbox" checked={values[f.id] === true} onChange={(e) => set(f.id, e.target.checked)} />
              {f.label}
            </label>
          ) : (
            <label key={f.id} className="field">
              {f.label}
              {f.type === "select" ? (
                <select className="select" value={String(values[f.id])} onChange={(e) => set(f.id, e.target.value)}>
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea className="textarea" value={String(values[f.id])} onChange={(e) => set(f.id, e.target.value)} />
              ) : (
                <input
                  className="input"
                  type={{ email: "email", phone: "tel", number: "text", date: "date" }[f.type as string] ?? "text"}
                  value={String(values[f.id])}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              )}
            </label>
          ),
        )}
      </div>
      <span className="faint">
        Se guarda en la entrada; si reenvías, el PDF saldrá con los datos nuevos. La app de acceso los verá al
        refrescar.
      </span>
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ResendForm({
  defaultTo,
  busy,
  onSend,
  onCancel,
}: {
  defaultTo: string;
  busy: boolean;
  onSend: (to: string | undefined, wholeOrder: boolean) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [whole, setWhole] = useState(false);
  return (
    <form
      className="stack card"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(to.trim() || undefined, whole);
      }}
    >
      <label className="field">
        Enviar a
        <input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Todas las entradas del
        pedido (no solo esta)
      </label>
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Enviando…" : "Reenviar"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** ¿Hay algo que devolver? (las invitaciones y entradas de 0 € no se cobraron). */
const canRefund = (t: IssuedTicketRow) => t.channel !== "invitacion" && t.priceCents !== 0;

const REFUND_TEXT: Record<RefundStatus, (amount: string) => string> = {
  PENDING: (a) => `Devolviendo ${a} a la tarjeta del comprador…`,
  MANUAL: (a) => `Pendiente de devolver ${a} en mano (venta de taquilla).`,
  SUCCEEDED: (a) => `${a} devueltos.`,
  FAILED: (a) => `No se pudo devolver ${a}.`,
};
const REFUND_NOTICE: Record<RefundStatus, string> = { PENDING: "warn", MANUAL: "warn", SUCCEEDED: "ok", FAILED: "error" };

/** Casilla e importe de la devolución (compartidos por anular y «devolver el dinero»). */
function RefundFields({
  ticket: t,
  enabled,
  onEnabled,
  amount,
  onAmount,
  optional,
}: {
  ticket: IssuedTicketRow;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
  optional: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {optional && (
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} /> Devolver el dinero
        </label>
      )}
      {enabled && (
        <label className="field">
          Importe a devolver (€)
          <input
            className="input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder={amount === "" ? "Lo pagado (lo calcula el sistema)" : undefined}
            style={{ maxWidth: 200 }}
          />
          <span className="hint">
            {t.channel === "taquilla"
              ? "Venta de taquilla: lo devuelves tú en mano y luego lo marcas como devuelto."
              : "Se devuelve automáticamente a la tarjeta del comprador, que recibirá un email."}
          </span>
        </label>
      )}
    </div>
  );
}

/** «12,50» → 1250; vacío → undefined (la API usa lo pagado por la entrada). */
function toCents(v: string): number | undefined | null {
  if (!v.trim()) return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

function VoidForm({
  ticket: t,
  busy,
  onVoid,
  onCancel,
}: {
  ticket: IssuedTicketRow;
  busy: boolean;
  onVoid: (
    release: boolean,
    reason: string | undefined,
    refund: { refund: boolean; refundCents?: number; wholeOrder: boolean },
  ) => void;
  onCancel: () => void;
}) {
  const refundable = canRefund(t);
  const [release, setRelease] = useState(true);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(refundable);
  const [amount, setAmount] = useState(centsToInput(t.priceCents));
  const [whole, setWhole] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack card"
      style={{ borderColor: "var(--red)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const cents = refund ? toCents(amount) : undefined;
        if (cents === null) return setError("Importe no válido");
        onVoid(release, reason.trim() || undefined, { refund: refund && refundable, refundCents: cents, wholeOrder: whole });
      }}
    >
      <strong>{whole ? `Anular el pedido entero (${t.orderLive} entradas)` : `Anular la entrada ${t.seat}`}</strong>
      <span className="muted" style={{ fontSize: 14 }}>
        Dejará de valer en el acceso (también sin conexión, al refrescar la app). No se puede deshacer.
        {t.status === "CHECKED_IN" && " Ojo: esta entrada ya se usó para entrar."}
      </span>
      {t.orderLive > 1 && (
        <label className="check">
          <input
            type="checkbox"
            checked={whole}
            onChange={(e) => {
              setWhole(e.target.checked);
              // Pedido entero: por defecto, lo pagado por todas sus entradas (lo calcula la API).
              setAmount(e.target.checked ? "" : centsToInput(t.priceCents));
            }}
          />{" "}
          Todo el pedido ({t.orderLive} entradas)
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} /> Volver a poner{" "}
        {whole ? "las plazas" : "la plaza"} a la venta
      </label>
      {refundable && (
        <RefundFields
          ticket={t}
          enabled={refund}
          onEnabled={setRefund}
          amount={amount}
          onAmount={setAmount}
          optional
        />
      )}
      <label className="field">
        Motivo (opcional; queda en el registro y, si hay devolución, se le indica al comprador)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn danger" disabled={busy}>
          {busy ? "Anulando…" : refund && refundable ? "Anular y devolver" : "Anular entrada"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function RefundForm({
  ticket: t,
  busy,
  onRefund,
  onCancel,
}: {
  ticket: IssuedTicketRow;
  busy: boolean;
  onRefund: (refundCents: number | undefined, reason?: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(centsToInput(t.priceCents));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack card"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = toCents(amount);
        if (cents === null) return setError("Importe no válido");
        onRefund(cents, reason.trim() || undefined);
      }}
    >
      <strong>Devolver el dinero de la entrada {t.seat}</strong>
      <RefundFields ticket={t} enabled onEnabled={() => {}} amount={amount} onAmount={setAmount} optional={false} />
      <label className="field">
        Motivo (opcional; se le indica al comprador)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Devolviendo…" : "Devolver"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ManualIssueForm({
  token,
  detail,
  onDone,
  onCancel,
}: {
  token: string;
  detail: EventDetail;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = Object.values(qty).reduce((a, b) => a + b, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await issueManualTickets(token, detail.event.id, {
        quantities: qty,
        buyerName: name.trim() || undefined,
        buyerEmail: email.trim() || undefined,
        sendEmail: send,
      });
      onDone(
        `${r.ticketIds.length} entrada(s) emitida(s)` + (r.emailed ? ` y enviadas a ${email.trim()}.` : ". No se han enviado por email."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: "var(--accent)" }}>
      <h3 className="section-title">Añadir entradas a mano (invitaciones)</h3>
      <span className="muted" style={{ fontSize: 14 }}>
        Se emiten sin cobro y cuentan para el aforo.
        {detail.event.seatingMode === "RESERVED" && " Se asignan los primeros asientos libres de cada categoría."}
      </span>
      <div className="grid2">
        {detail.ticketTypes.map((t) => (
          <label key={t.id} className="field">
            {t.name}
            <span className="hint">
              {t.capacity - t.sold} libres de {t.capacity}
            </span>
            <input
              className="input"
              type="number"
              min={0}
              max={50}
              value={qty[t.id] ?? 0}
              onChange={(e) => setQty((p) => ({ ...p, [t.id]: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>
        ))}
      </div>
      <div className="grid2">
        <label className="field">
          Nombre del invitado
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          <span className="hint">Si el formulario pide el nombre, se usa como titular de las entradas.</span>
        </label>
        <label className="field">
          Email
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={send} disabled={!email.trim()} onChange={(e) => setSend(e.target.checked)} />{" "}
        Enviarle las entradas por email
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || total === 0}>
          {busy ? "Emitiendo…" : `Emitir ${total || ""} entrada${total === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
