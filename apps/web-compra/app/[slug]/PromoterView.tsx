import { ExternalLink, Globe, Mail, Phone } from "lucide-react";
import { accentOf, fetchEvents, fetchPastEvents, fetchProfile, inkFor, type Profile, themeOf } from "../../lib/api";
import EmbedHeight from "../embed/EmbedHeight";
import EventsBrowser from "./EventsBrowser";

const SOCIAL_LABELS: [keyof Profile, string][] = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["x", "X"],
  ["youtube", "YouTube"],
];

/**
 * Página pública del promotor: portada con su identidad, evento destacado, cartelera en
 * rejilla de carteles con filtros y, a la derecha, «sobre nosotros» y contacto. Incrustada
 * (`embed`) en la web del promotor, solo la cartelera: su web ya tiene su cabecera.
 */
export default async function PromoterView({ slug, embed = false }: { slug: string; embed?: boolean }) {
  const [profile, events, past] = await Promise.all([fetchProfile(slug), fetchEvents(slug), fetchPastEvents(slug)]);
  const accent = accentOf(profile);
  const socials = SOCIAL_LABELS.filter(([k]) => profile[k]);
  // Solo se fuerza el color si el promotor eligió uno; si no, cada tema usa su azul.
  const themeVars = (profile.accentColor ? { "--accent": accent, "--accent-ink": inkFor(accent) } : {}) as React.CSSProperties;
  const hasAbout = !!(profile.description || profile.website || socials.length || profile.contactEmail || profile.phone);

  if (embed) {
    return (
      <div className="theme-root embed" data-theme={themeOf(profile)} style={themeVars}>
        <EmbedHeight />
        <main className="page-wide">
          <EventsBrowser base={`/embed/${slug}`} events={events} past={[]} />
        </main>
      </div>
    );
  }

  return (
    <div className="theme-root" data-theme={themeOf(profile)} style={themeVars}>
      <main className="page-wide">
        <div
          className="pr-cover"
          style={{
            backgroundImage: profile.coverUrl
              ? `url("${profile.coverUrl}")`
              : `linear-gradient(135deg, ${accent}55, ${accent}11 60%, transparent)`,
          }}
        />
        <div className="pr-id">
          <div
            className="pr-logo"
            style={{
              backgroundImage: profile.logoUrl ? `url("${profile.logoUrl}")` : undefined,
              backgroundColor: profile.logoUrl ? "#fff" : accent,
              color: inkFor(accent),
            }}
          >
            {!profile.logoUrl && profile.name[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="pr-name">{profile.name}</h1>
            {(profile.tagline || profile.city) && (
              <p className="pr-sub">{[profile.tagline, profile.city].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        </div>

        <div className="pr-grid" style={hasAbout ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
          <EventsBrowser base={`/${slug}`} events={events} past={past} />

          {hasAbout && (
            <aside className="pr-aside">
              <div className="card" style={{ display: "grid", gap: 12 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Sobre {profile.name}</h2>
                {profile.description && (
                  <p className="prose" style={{ fontSize: 14, color: "var(--muted)" }}>
                    {profile.description}
                  </p>
                )}
                <div className="pr-links">
                  {profile.website && (
                    <a className="pr-link" href={profile.website} target="_blank" rel="noreferrer">
                      <Globe size={16} /> Web
                    </a>
                  )}
                  {socials.map(([k, label]) => (
                    <a key={k} className="pr-link" href={profile[k] as string} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} /> {label}
                    </a>
                  ))}
                  {profile.contactEmail && (
                    <a className="pr-link" href={`mailto:${profile.contactEmail}`}>
                      <Mail size={16} /> {profile.contactEmail}
                    </a>
                  )}
                  {profile.phone && (
                    <a className="pr-link" href={`tel:${profile.phone.replace(/\s+/g, "")}`}>
                      <Phone size={16} /> {profile.phone}
                    </a>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
