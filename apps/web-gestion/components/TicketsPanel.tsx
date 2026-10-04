"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AttendeeField,
  downloadTicketsCsv,
  type EventDetail,
  type IssuedTicketRow,
  issueManualTickets,
  listAttendeeFields,
  listTickets,
  resendTicket,
  type TicketChannel,
  type TicketFilters,
  type TicketPage,
  type TicketStatus,
  updateTicketAttendee,
  voidTicket,
} from "../lib/api";
import { formatInZone } from "../lib/time";

const STATUS_LABEL: Record<TicketStatus, string> = { ISSUED: "Válida", CHECKED_IN: "Validada", VOID: "Anulada" };
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
        <td>{CHANNEL_LABEL[t.channel]}</td>
        <td>
          <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span>
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
  const [mode, setMode] = useState<"view" | "edit" | "resend" | "void">("view");
  const [busy, setBusy] = useState(false);
  const applicable = fields.filter(
    (f) => !f.ticketTypeIds?.length || (t.ticketTypeId != null && f.ticketTypeIds.includes(t.ticketTypeId)),
  );
  const isVoid = t.status === "VOID";

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
      </div>

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
          onVoid={(release, reason) =>
            run(async () => {
              await voidTicket(token, eventId, t.id, { release, reason });
              return release ? "Entrada anulada y plaza de nuevo a la venta." : "Entrada anulada (la plaza sigue bloqueada).";
            })
          }
        />
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

function VoidForm({
  ticket: t,
  busy,
  onVoid,
  onCancel,
}: {
  ticket: IssuedTicketRow;
  busy: boolean;
  onVoid: (release: boolean, reason?: string) => void;
  onCancel: () => void;
}) {
  const [release, setRelease] = useState(true);
  const [reason, setReason] = useState("");
  return (
    <form
      className="stack card"
      style={{ borderColor: "var(--red)" }}
      onSubmit={(e) => {
        e.preventDefault();
        onVoid(release, reason.trim() || undefined);
      }}
    >
      <strong>Anular la entrada {t.seat}</strong>
      <span className="muted" style={{ fontSize: 14 }}>
        Dejará de valer en el acceso (también sin conexión, al refrescar la app). No se puede deshacer y{" "}
        <strong>no devuelve el dinero</strong>: si hay que reembolsar, hazlo aparte.
        {t.status === "CHECKED_IN" && " Ojo: esta entrada ya se usó para entrar."}
      </span>
      <label className="check">
        <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} /> Volver a poner la
        plaza a la venta
      </label>
      <label className="field">
        Motivo (opcional, queda en el registro)
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      <div className="row">
        <button className="btn danger" disabled={busy}>
          {busy ? "Anulando…" : "Anular entrada"}
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
