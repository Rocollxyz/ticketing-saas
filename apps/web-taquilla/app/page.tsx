"use client";

import { useEffect, useState } from "react";
import { listEvents, login, type PosEvent } from "../lib/api";
import PosTerminal from "../components/PosTerminal";

export default function Page() {
  const [token, setToken] = useState<string | null>(null);
  const [events, setEvents] = useState<PosEvent[]>([]);
  const [event, setEvent] = useState<PosEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem("taquilla_token");
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    listEvents(token)
      .then(setEvents)
      .catch((e) => {
        setError(String(e));
        if (String(e).startsWith("401")) logout();
      });
  }, [token]);

  function logout() {
    localStorage.removeItem("taquilla_token");
    setToken(null);
    setEvents([]);
    setEvent(null);
  }

  if (!token)
    return (
      <LoginForm
        onToken={(t) => {
          localStorage.setItem("taquilla_token", t);
          setToken(t);
        }}
      />
    );

  if (event) return <PosTerminal token={token} eventId={event.id} eventName={event.name} onBack={() => setEvent(null)} />;

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>Taquilla · POS</h1>
        <button onClick={logout} style={linkBtn}>
          salir
        </button>
      </header>
      <h2 style={{ fontSize: 16 }}>Eventos a la venta</h2>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      {events.length === 0 && <p style={{ color: "#7a8190" }}>No hay eventos a la venta.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => setEvent(e)}
            style={{ textAlign: "left", padding: "14px 16px", borderRadius: 8, border: "1px solid #2b313c", background: "#171a21", color: "#e9edf2", cursor: "pointer" }}
          >
            <strong>{e.name}</strong> <span style={{ fontSize: 12, color: "#7a8190" }}>· {e.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#5b9dff", cursor: "pointer", fontSize: 14, padding: 0 };

function LoginForm({ onToken }: { onToken: (t: string) => void }) {
  const [email, setEmail] = useState("taquillero@demo.test");
  const [password, setPassword] = useState("taquillero123");
  const [slug, setSlug] = useState("demo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password, slug);
      onToken(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 340, margin: "60px auto", display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: 20, textAlign: "center" }}>Acceso taquilla</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" placeholder="email" style={input} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="contraseña" style={input} />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} autoCapitalize="none" placeholder="promotor (slug)" style={input} />
      {error && <p style={{ color: "#ff6b6b", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy} style={{ padding: "10px 0", borderRadius: 8, border: "none", background: "#5b9dff", color: "#fff", fontSize: 15, cursor: "pointer" }}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: "1px solid #2b313c", background: "#0f1115", color: "#e9edf2", fontSize: 14 };
