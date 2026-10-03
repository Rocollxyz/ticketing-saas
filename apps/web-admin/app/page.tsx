"use client";

import { useEffect, useState } from "react";
import { createTenant, euros, listTenants, login, type TenantRow } from "../lib/api";

export default function Page() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem("admin_token");
    if (t) setToken(t);
  }, []);

  function onToken(t: string) {
    localStorage.setItem("admin_token", t);
    setToken(t);
  }
  function logout() {
    localStorage.removeItem("admin_token");
    setToken(null);
  }

  if (!token) return <LoginForm onToken={onToken} />;
  return <Dashboard token={token} onLogout={logout} />;
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function reload() {
    setError(null);
    try {
      setTenants(await listTenants(token));
    } catch (e) {
      setError(String(e));
      if (String(e).startsWith("401")) onLogout();
    }
  }
  useEffect(() => {
    reload();
  }, []);

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>Admin SaaS · Plataforma</h1>
        <button onClick={onLogout} style={linkBtn}>
          salir
        </button>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <h2 style={{ fontSize: 16 }}>Promotores ({tenants.length})</h2>
        <button style={btnPrimary} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cerrar" : "+ Nuevo promotor"}
        </button>
      </div>

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

      {showForm && (
        <CreateForm
          token={token}
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#7a8190", fontSize: 13 }}>
            <th style={th}>Promotor</th>
            <th style={th}>Slug</th>
            <th style={thR}>Eventos</th>
            <th style={thR}>Entradas</th>
            <th style={thR}>Recaudación</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} style={{ borderTop: "1px solid #1f2530" }}>
              <td style={td}>
                <strong>{t.name}</strong>
              </td>
              <td style={{ ...td, color: "#9aa3b2" }}>{t.slug}</td>
              <td style={tdR}>{t.eventsCount}</td>
              <td style={tdR}>{t.ticketsCount}</td>
              <td style={tdR}>{euros(t.revenueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await createTenant(token, { name, slug, adminEmail, adminPassword });
      setOk(`Promotor "${res.name}" creado. Acceso: ${res.adminEmail} (slug ${res.slug}).`);
      setName("");
      setSlug("");
      setAdminEmail("");
      setAdminPassword("");
      onCreated();
    } catch (e) {
      const m = String(e);
      setError(m.includes("409") ? "Ese slug o email ya existe" : m.includes("400") ? "Datos inválidos (slug en minúsculas, contraseña ≥ 8)" : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ background: "#13161c", border: "1px solid #1f2530", borderRadius: 10, padding: 16, marginTop: 12, display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>Alta de promotor</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del promotor" style={input} />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (minúsculas, p.ej. acme)" style={input} autoCapitalize="none" />
      <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="email del admin" style={input} autoCapitalize="none" />
      <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} type="password" placeholder="contraseña del admin (≥ 8)" style={input} />
      {error && <p style={{ color: "#ff6b6b", margin: 0 }}>{error}</p>}
      {ok && <p style={{ color: "#3ecf8e", margin: 0 }}>{ok}</p>}
      <button type="submit" disabled={busy} style={btnPrimary}>
        {busy ? "Creando…" : "Crear promotor"}
      </button>
    </form>
  );
}

function LoginForm({ onToken }: { onToken: (t: string) => void }) {
  const [email, setEmail] = useState("root@platform.test");
  const [password, setPassword] = useState("root1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      onToken(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 340, margin: "60px auto", display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: 20, textAlign: "center" }}>Admin de plataforma</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" placeholder="email" style={input} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="contraseña" style={input} />
      {error && <p style={{ color: "#ff6b6b", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy} style={{ ...btnPrimary, padding: "10px 0" }}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: "1px solid #2b313c", background: "#0f1115", color: "#e9edf2", fontSize: 14 };
const btnPrimary: React.CSSProperties = { padding: "10px 16px", borderRadius: 8, border: "none", background: "#5b9dff", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#5b9dff", cursor: "pointer", fontSize: 14, padding: 0 };
const th: React.CSSProperties = { padding: "8px 6px", fontWeight: 600 };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 6px", fontSize: 14 };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
