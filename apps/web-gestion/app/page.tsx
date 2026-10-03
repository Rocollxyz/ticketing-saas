"use client";

import { useCallback, useEffect, useState } from "react";
import EventEditor from "../components/EventEditor";
import EventsList from "../components/EventsList";
import ProfileForm from "../components/ProfileForm";
import { login } from "../lib/api";

export default function Page() {
  const [token, setToken] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [section, setSection] = useState<"events" | "profile">("events");

  // Sesión persistida (dev). En producción iría en cookie httpOnly.
  useEffect(() => {
    // Sesiones antiguas sin slug guardado → se pide login de nuevo (hace falta el
    // slug para el enlace público del evento).
    const t = localStorage.getItem("gestion_token");
    const s = localStorage.getItem("gestion_slug");
    if (t && s) {
      setToken(t);
      setSlug(s);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("gestion_token");
    localStorage.removeItem("gestion_slug");
    setToken(null);
    setEventId(null);
  }, []);

  if (!token)
    return (
      <LoginForm
        onLogin={(t, s) => {
          localStorage.setItem("gestion_token", t);
          localStorage.setItem("gestion_slug", s);
          setToken(t);
          setSlug(s);
        }}
      />
    );

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Consola del promotor</h1>
        <span>
          {slug && <span className="faint" style={{ marginRight: 12 }}>{slug}</span>}
          <button onClick={logout} style={linkBtn}>
            salir
          </button>
        </span>
      </header>

      <nav className="tabs" style={{ marginTop: 0 }}>
        <button
          className={`tab ${section === "events" ? "active" : ""}`}
          onClick={() => {
            setSection("events");
            setEventId(null);
          }}
        >
          Eventos
        </button>
        <button className={`tab ${section === "profile" ? "active" : ""}`} onClick={() => setSection("profile")}>
          Perfil público
        </button>
      </nav>

      {section === "profile" ? (
        <ProfileForm token={token} />
      ) : !eventId ? (
        <EventsList token={token} onOpen={setEventId} onAuthError={logout} />
      ) : (
        <EventEditor
          token={token}
          eventId={eventId}
          slug={slug}
          onBack={() => setEventId(null)}
          onOpen={setEventId}
        />
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5b9dff",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
};

function LoginForm({ onLogin }: { onLogin: (token: string, slug: string) => void }) {
  const [email, setEmail] = useState("admin@demo.test");
  const [password, setPassword] = useState("demo1234");
  const [slug, setSlug] = useState("demo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password, slug);
      onLogin(res.token, res.tenant);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 340, margin: "60px auto", display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: 20, textAlign: "center" }}>Acceso promotor</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={input} />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        placeholder="contraseña"
        style={input}
      />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="promotor (slug)" style={input} />
      {error && <p style={{ color: "#ff6b6b", margin: 0 }}>{error}</p>}
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "10px 0",
          borderRadius: 8,
          border: "none",
          background: "#5b9dff",
          color: "#fff",
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2b313c",
  background: "#0f1115",
  color: "#e9edf2",
  fontSize: 14,
};
