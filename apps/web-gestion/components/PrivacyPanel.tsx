"use client";

import { useEffect, useState } from "react";
import {
  erasePersonalData,
  exportPersonalData,
  getProfile,
  type PersonalData,
  searchPersonalData,
  updateProfile,
} from "../lib/api";

/**
 * Protección de datos (RGPD). Eres el responsable de los datos de tus compradores: aquí
 * configuras lo que se les muestra al comprar y atiendes sus peticiones de acceso y
 * supresión.
 */
export default function PrivacyPanel({ token }: { token: string }) {
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Eres el <strong>responsable</strong> de los datos de tus compradores y asistentes (la plataforma los trata por
        encargo tuyo). Al comprar se les informa de quién eres, para qué se usan los datos, cuánto tiempo se guardan y
        dónde ejercer sus derechos (el email de contacto de tu perfil).
      </p>
      <Settings token={token} />
      <Requests token={token} />
    </div>
  );
}

function Settings({ token }: { token: string }) {
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("");
  const [days, setDays] = useState("365");
  const [contact, setContact] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getProfile(token)
      .then((p) => {
        setPrivacyUrl(p.privacyUrl ?? "");
        setTermsUrl(p.termsUrl ?? "");
        setDays(String(p.attendeeRetentionDays));
        setContact(p.contactEmail);
      })
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [token]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await updateProfile(token, {
        privacyUrl: privacyUrl.trim() || null,
        termsUrl: termsUrl.trim() || null,
        attendeeRetentionDays: Number(days),
      });
      setMsg({ ok: true, text: "Guardado." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h3 className="section-title">Lo que ve el comprador</h3>
      {!contact && (
        <div className="notice warn">
          Falta el email de contacto en tu perfil público: es donde los compradores ejercen sus derechos.
        </div>
      )}
      <div className="grid2" style={{ alignItems: "start" }}>
        <label className="field">
          Política de privacidad (URL)
          <input className="input" value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          Condiciones de compra (URL)
          <input className="input" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          Borrar datos de asistentes tras el evento (días)
          <input className="input" type="number" min={30} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          <span className="hint">
            Nombre, DNI y demás respuestas del formulario. Las facturas se conservan siempre (obligación legal).
          </span>
        </label>
      </div>
      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          Guardar
        </button>
      </div>
    </form>
  );
}

function Requests({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [data, setData] = useState<PersonalData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  const search = () => run(async () => setData(await searchPersonalData(token, email.trim())));

  return (
    <div className="card stack">
      <h3 className="section-title">Peticiones de acceso o supresión</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Si alguien te pide sus datos o que los borres, búscalo por email. Tienes un mes para responder.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="input"
          type="email"
          required
          style={{ flex: 1, minWidth: 220 }}
          placeholder="email de la persona"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>
          Buscar
        </button>
      </form>
      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {data &&
        (data.orders.length === 0 ? (
          <p className="muted">No hay datos de {data.email}.</p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>
              {data.orders.length} pedido(s) con datos de <strong>{data.email}</strong>:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {data.orders.map((o) => (
                <li key={o.id}>
                  {o.eventName} · {new Date(o.createdAt).toLocaleDateString("es-ES")} · {o.tickets.length} entrada(s)
                  {o.anonymizedAt && <span className="faint"> · ya suprimido</span>}
                  {o.invoices.length > 0 && (
                    <span className="faint"> · facturas {o.invoices.map((i) => i.fullNumber).join(", ")} (se conservan)</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => run(() => exportPersonalData(token, data.email))}>
                Descargar sus datos (JSON)
              </button>
              <span className="spacer" />
              <button
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  window.confirm(
                    `¿Suprimir los datos de ${data.email}? Se borran su nombre, email, datos de facturación y los de sus ` +
                      "asistentes. Sus entradas siguen siendo válidas, pero ya no se le podrán reenviar. No se puede deshacer.",
                  ) &&
                  run(async () => {
                    const r = await erasePersonalData(token, data.email);
                    setMsg({ ok: true, text: `Datos suprimidos en ${r.orders} pedido(s) y ${r.tickets} entrada(s).` });
                    setData(await searchPersonalData(token, data.email));
                  })
                }
              >
                Suprimir sus datos
              </button>
            </div>
          </>
        ))}
    </div>
  );
}
