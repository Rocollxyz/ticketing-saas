"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type BillingData,
  downloadInvoiceBook,
  downloadInvoicePdf,
  euros,
  getProfile,
  type InvoiceList,
  type InvoiceRow,
  issuePendingInvoices,
  listInvoices,
  type Profile,
  replaceInvoice,
  updateProfile,
} from "../lib/api";

/** Primer día del mes `offset` meses atrás, en ISO (para filtrar por mes). */
function monthStart(offset: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - offset, 1).toISOString();
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  from: monthStart(i),
  to: monthStart(i - 1),
  label: new Date(monthStart(i)).toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
}));

/**
 * Facturación: las entradas las vende el promotor, así que las facturas salen a su
 * nombre. Datos fiscales, facturas emitidas (PDF), canje de simplificada por completa
 * y libro registro de facturas expedidas para la gestoría.
 */
export default function BillingPanel({ token }: { token: string }) {
  const [data, setData] = useState<InvoiceList | null>(null);
  const [month, setMonth] = useState<number | "all">(0);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [editFiscal, setEditFiscal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const range = month === "all" ? { from: undefined, to: undefined } : MONTHS[month];
  const reload = useCallback(
    () =>
      listInvoices(token, range.from, range.to)
        .then(setData)
        .catch((e) => setError(e.message)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, month],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <div className="notice error">{error}</div> : <p className="muted">Cargando…</p>;
  const pending = data.pendingOrders + data.pendingRectifications;
  const totals = data.invoices.reduce(
    (a, i) => ({ base: a.base + i.baseCents, tax: a.tax + i.taxCents, total: a.total + i.totalCents }),
    { base: 0, tax: 0, total: 0 },
  );

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Tú vendes las entradas: cada compra genera una factura <strong>a tu nombre</strong> que se envía al comprador.
        Simplificada hasta 400 €; completa si el comprador da sus datos (obligatorio por encima de 400 €). Cada
        devolución genera su factura rectificativa.
      </p>
      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {(!data.fiscalReady || editFiscal) && (
        <FiscalForm
          token={token}
          required={!data.fiscalReady}
          onSaved={() => {
            setEditFiscal(false);
            void run(async () => "Datos fiscales guardados.");
          }}
          onCancel={data.fiscalReady ? () => setEditFiscal(false) : undefined}
        />
      )}

      {data.fiscalReady && pending > 0 && (
        <div className="notice warn row">
          <span style={{ flex: 1 }}>
            {data.pendingOrders > 0 && `${data.pendingOrders} pedido(s) cobrados sin factura. `}
            {data.pendingRectifications > 0 && `${data.pendingRectifications} devolución(es) sin rectificativa.`}
          </span>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await issuePendingInvoices(token);
                return `${r.issued} factura(s) y ${r.rectifications} rectificativa(s) emitidas.`;
              })
            }
          >
            Emitirlas ahora
          </button>
        </div>
      )}

      <div className="row">
        <select
          className="select"
          style={{ width: "auto" }}
          value={String(month)}
          onChange={(e) => setMonth(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          {MONTHS.map((m, i) => (
            <option key={m.from} value={i}>
              {m.label}
            </option>
          ))}
          <option value="all">Todas</option>
        </select>
        <span className="faint">
          {data.invoices.length} facturas · base {euros(totals.base)} · impuesto {euros(totals.tax)} · total{" "}
          {euros(totals.total)}
        </span>
        <span className="spacer" />
        {data.fiscalReady && !editFiscal && (
          <button className="btn" onClick={() => setEditFiscal(true)}>
            Datos fiscales
          </button>
        )}
        <button
          className="btn"
          disabled={data.invoices.length === 0}
          onClick={() => run(() => downloadInvoiceBook(token, range.from, range.to))}
        >
          Libro de facturas (CSV)
        </button>
      </div>

      {data.invoices.length === 0 ? (
        <p className="muted">No hay facturas en este periodo.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Evento</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <InvoiceRows
                  key={i.id}
                  inv={i}
                  busy={busy}
                  replacing={replacing === i.id}
                  onPdf={() => run(() => downloadInvoicePdf(token, i.id))}
                  onReplace={() => setReplacing(replacing === i.id ? null : i.id)}
                  onSubmitReplace={(c) =>
                    run(async () => {
                      const r = await replaceInvoice(token, i.id, c);
                      setReplacing(null);
                      return `Emitida la factura completa ${r.fullNumber}, que sustituye a ${i.fullNumber}.`;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceRows({
  inv: i,
  busy,
  replacing,
  onPdf,
  onReplace,
  onSubmitReplace,
}: {
  inv: InvoiceRow;
  busy: boolean;
  replacing: boolean;
  onPdf: () => void;
  onReplace: () => void;
  onSubmitReplace: (c: BillingData) => void;
}) {
  const canReplace = i.kind === "SIMPLIFIED" && !i.replaced;
  return (
    <>
      <tr>
        <td>
          <code>{i.fullNumber}</code>
          <div className="faint">
            {i.kindLabel}
            {i.replaced && " · canjeada"}
          </div>
          {i.needsFull && <div style={{ color: "var(--amber)", fontSize: 12 }}>Más de 400 €: canjéala por completa</div>}
        </td>
        <td className="faint" style={{ fontSize: 13 }}>
          {new Date(i.issuedAt).toLocaleDateString("es-ES")}
        </td>
        <td>
          {i.customer ? (
            <>
              {i.customer.name}
              <div className="faint">{i.customer.taxId}</div>
            </>
          ) : (
            <>
              {i.buyerName ?? i.buyerEmail ?? "—"}
              {i.buyerName && i.buyerEmail && <div className="faint">{i.buyerEmail}</div>}
            </>
          )}
        </td>
        <td style={{ fontSize: 13 }}>{i.eventName}</td>
        <td style={{ textAlign: "right", color: i.totalCents < 0 ? "var(--red)" : undefined }}>
          {euros(i.totalCents)}
          <div className="faint">
            {i.taxName} {euros(i.taxCents)}
          </div>
        </td>
        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
          <button className="btn" disabled={busy} onClick={onPdf}>
            PDF
          </button>{" "}
          {canReplace && (
            <button className="btn" disabled={busy} onClick={onReplace}>
              Completa…
            </button>
          )}
        </td>
      </tr>
      {replacing && (
        <tr>
          <td colSpan={6} style={{ background: "var(--bg)" }}>
            <BillingDataForm busy={busy} onCancel={onReplace} onSubmit={onSubmitReplace} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Datos del destinatario para el canje por factura completa. */
function BillingDataForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (c: BillingData) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<BillingData>({ name: "", taxId: "", address: "", postalCode: "", city: "" });
  const field = (k: keyof BillingData, label: string, max = 200) => (
    <label className="field">
      {label}
      <input
        className="input"
        required={k !== "country"}
        maxLength={max}
        value={c[k] ?? ""}
        onChange={(e) => setC((p) => ({ ...p, [k]: e.target.value }))}
      />
    </label>
  );
  return (
    <form
      className="stack"
      style={{ padding: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(c);
      }}
    >
      <strong>Factura completa a nombre de…</strong>
      <span className="faint">Sustituye a la simplificada (no la anula: queda referenciada).</span>
      <div className="grid2">
        {field("name", "Nombre o razón social")}
        {field("taxId", "NIF", 20)}
        {field("address", "Dirección", 300)}
        {field("postalCode", "Código postal", 10)}
        {field("city", "Población", 100)}
        {field("country", "País (si no es España)", 60)}
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy}>
          Emitir factura completa
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

type FiscalFields = Pick<
  Profile,
  "fiscalName" | "taxId" | "fiscalAddress" | "fiscalPostalCode" | "fiscalCity" | "fiscalProvince" | "taxRegime"
>;

function FiscalForm({
  token,
  required,
  onSaved,
  onCancel,
}: {
  token: string;
  required: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<FiscalFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile(token)
      .then((p) =>
        setF({
          fiscalName: p.fiscalName,
          taxId: p.taxId,
          fiscalAddress: p.fiscalAddress,
          fiscalPostalCode: p.fiscalPostalCode,
          fiscalCity: p.fiscalCity,
          fiscalProvince: p.fiscalProvince,
          taxRegime: p.taxRegime,
        }),
      )
      .catch((e) => setError(e.message));
  }, [token]);

  if (!f) return error ? <div className="notice error">{error}</div> : null;
  const field = (k: Exclude<keyof FiscalFields, "taxRegime">, label: string, max = 200, req = true) => (
    <label className="field">
      {label}
      <input
        className="input"
        required={req}
        maxLength={max}
        value={f[k] ?? ""}
        onChange={(e) => setF((p) => ({ ...p!, [k]: e.target.value }))}
      />
    </label>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateProfile(token, { ...f!, fiscalProvince: f!.fiscalProvince || null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ borderColor: required ? "var(--amber)" : "var(--accent)" }}>
      <h3 className="section-title">Datos fiscales</h3>
      {required && (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Sin estos datos no se pueden emitir facturas. Las ventas que hagas mientras tanto quedan pendientes y podrás
          facturarlas después.
        </p>
      )}
      <div className="grid2">
        {field("fiscalName", "Razón social o nombre y apellidos")}
        {field("taxId", "NIF", 20)}
        {field("fiscalAddress", "Dirección fiscal", 300)}
        {field("fiscalPostalCode", "Código postal", 10)}
        {field("fiscalCity", "Población", 100)}
        {field("fiscalProvince", "Provincia", 100, false)}
        <label className="field">
          Impuesto
          <select
            className="select"
            value={f.taxRegime}
            onChange={(e) => setF((p) => ({ ...p!, taxRegime: e.target.value as "IVA" | "IGIC" }))}
          >
            <option value="IVA">IVA (península y Baleares)</option>
            <option value="IGIC">IGIC (Canarias)</option>
          </select>
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
