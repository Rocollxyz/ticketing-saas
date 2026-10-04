"use client";

import { useEffect, useState } from "react";
import { getProfile, type Profile, SHOP_URL, updateProfile } from "../lib/api";
import ImageField from "./ImageField";

type Form = Record<Exclude<keyof Profile, "slug">, string>;

const FIELDS = [
  "name", "tagline", "description", "logoUrl", "coverUrl", "accentColor", "shopTheme", "city",
  "contactEmail", "phone", "website", "instagram", "facebook", "tiktok", "x", "youtube",
] as const;

const toForm = (p: Profile): Form =>
  Object.fromEntries(FIELDS.map((k) => [k, p[k] ?? ""])) as Form;

const SOCIALS: { key: "instagram" | "facebook" | "tiktok" | "x" | "youtube"; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
  { key: "x", label: "X (Twitter)" },
  { key: "youtube", label: "YouTube" },
];

/** Perfil público del promotor: lo que ve el comprador en la cabecera de su página. */
export default function ProfileForm({ token }: { token: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getProfile(token)
      .then((p) => {
        setProfile(p);
        setF(toForm(p));
      })
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [token]);

  if (!f || !profile) return msg ? <div className="notice error">{msg.text}</div> : <p className="muted">Cargando…</p>;
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p!, [k]: v }));
  const publicUrl = `${SHOP_URL}/${profile.slug}`;
  const accent = /^#[0-9a-f]{6}$/i.test(f.accentColor) ? f.accentColor : "#5b9dff";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      // Vacío → null (borra el campo).
      const data = Object.fromEntries(FIELDS.map((k) => [k, f![k].trim() || null])) as Partial<Profile>;
      const saved = await updateProfile(token, data);
      setProfile(saved);
      setF(toForm(saved)); // la API normaliza (p.ej. @usuario → URL)
      setMsg({ ok: true, text: "Perfil guardado." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <div className="row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Perfil público</h2>
        <span className="spacer" />
        <a className="btn" href={publicUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          Ver mi página ↗
        </a>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Es la cabecera de tu página en la tienda (<span className="faint">{publicUrl}</span>) y aparece como
        organizador en cada evento.
      </p>

      {/* Vista previa de la cabecera */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            height: 110,
            background: f.coverUrl ? `center/cover url("${f.coverUrl}")` : `linear-gradient(135deg, ${accent}55, #161d27)`,
          }}
        />
        <div className="row" style={{ padding: "0 16px 16px", marginTop: -36, alignItems: "flex-start" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 14,
              border: "3px solid var(--card)",
              background: f.logoUrl ? `center/cover url("${f.logoUrl}") #fff` : accent,
              display: "grid",
              placeItems: "center",
              fontSize: 28,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {!f.logoUrl && (f.name.trim()[0] ?? "?").toUpperCase()}
          </div>
          <div style={{ paddingTop: 42 }}>
            <strong style={{ fontSize: 18 }}>{f.name || "—"}</strong>
            {f.tagline && <div className="muted" style={{ fontSize: 13 }}>{f.tagline}</div>}
          </div>
        </div>
      </div>

      <section className="card stack">
        <h3 className="section-title">Identidad</h3>
        <div className="grid2">
          <label className="field">
            Nombre del promotor
            <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
          </label>
          <label className="field">
            Lema
            <input
              className="input"
              value={f.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              maxLength={160}
              placeholder="Conciertos y festivales en Barcelona"
            />
          </label>
          <ImageField
            token={token}
            kind="logo"
            label="Logo"
            hint="Cuadrado, mínimo 200×200."
            value={f.logoUrl}
            onChange={(url) => set("logoUrl", url)}
            aspect="1 / 1"
          />
          <ImageField
            token={token}
            kind="cover"
            label="Imagen de portada"
            hint="Horizontal, recomendado 2400×600."
            value={f.coverUrl}
            onChange={(url) => set("coverUrl", url)}
            aspect="4 / 1"
          />
          <label className="field">
            Color de marca
            <span className="row" style={{ gap: 8 }}>
              <input
                type="color"
                value={accent}
                onChange={(e) => set("accentColor", e.target.value)}
                style={{ width: 44, height: 36, border: 0, background: "none", padding: 0 }}
              />
              <input
                className="input"
                value={f.accentColor}
                onChange={(e) => set("accentColor", e.target.value)}
                placeholder="#5b9dff"
                style={{ flex: 1 }}
              />
            </span>
            <span className="hint">Botones y enlaces de tu página.</span>
          </label>
          <label className="field">
            Tema de la tienda
            <select className="select" value={f.shopTheme || "light"} onChange={(e) => set("shopTheme", e.target.value)}>
              <option value="light">Claro</option>
              <option value="dark">Oscuro</option>
            </select>
            <span className="hint">Fondo de tu página y de la de tus eventos. Oscuro: salas, clubs, música electrónica.</span>
          </label>
          <label className="field">
            Ciudad
            <input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} />
          </label>
        </div>
        <label className="field">
          Sobre nosotros
          <textarea
            className="textarea"
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder="Quiénes sois, qué tipo de eventos organizáis…"
          />
        </label>
      </section>

      <section className="card stack">
        <h3 className="section-title">Contacto y redes</h3>
        <div className="grid2">
          <label className="field">
            Email de contacto
            <input className="input" type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
          </label>
          <label className="field">
            Teléfono
            <input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </label>
          <label className="field">
            Web
            <input className="input" type="url" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
          </label>
          {SOCIALS.map((s) => (
            <label key={s.key} className="field">
              {s.label}
              <input className="input" value={f[s.key]} onChange={(e) => set(s.key, e.target.value)} placeholder="@usuario o URL" />
            </label>
          ))}
        </div>
      </section>

      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
        <button className="btn success" disabled={saving}>
          {saving ? "Guardando…" : "Guardar perfil"}
        </button>
      </div>
    </form>
  );
}
