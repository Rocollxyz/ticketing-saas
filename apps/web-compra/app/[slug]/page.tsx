import type { Metadata } from "next";
import { accentOf, themeOf, fetchEvents, fetchPastEvents, fetchProfile, type Profile } from "../../lib/api";
import EventsBrowser from "./EventsBrowser";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = await fetchProfile(slug);
  return { title: `${p.name} · Entradas`, description: p.tagline ?? p.description?.slice(0, 160) ?? undefined };
}

const SOCIAL_LABELS: [keyof Profile, string][] = [
  ["website", "Web"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["x", "X"],
  ["youtube", "YouTube"],
];

/** Página pública del promotor: cabecera con su perfil + cartelera con filtros. */
export default async function PromoterPage({ params }: Params) {
  const { slug } = await params;
  const [profile, events, past] = await Promise.all([fetchProfile(slug), fetchEvents(slug), fetchPastEvents(slug)]);
  const accent = accentOf(profile);
  const links = SOCIAL_LABELS.filter(([k]) => profile[k]);

  return (
    <div className="theme-root" data-theme={themeOf(profile)}>
    <main className="page">
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            height: 180,
            borderRadius: 14,
            background: profile.coverUrl
              ? `center/cover url("${profile.coverUrl}")`
              : `linear-gradient(135deg, ${accent}66, var(--stage-to) 70%)`,
          }}
        />
        {/* Solo el logo se superpone a la portada; el nombre queda debajo. */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: -48, padding: "0 16px" }}>
          <div
            style={{
              width: 96,
              height: 96,
              flexShrink: 0,
              borderRadius: 18,
              border: "4px solid var(--bg)",
              background: profile.logoUrl ? `center/cover url("${profile.logoUrl}") #fff` : accent,
              display: "grid",
              placeItems: "center",
              fontSize: 40,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {!profile.logoUrl && profile.name[0]?.toUpperCase()}
          </div>
          <div style={{ paddingTop: 56 }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>{profile.name}</h1>
            {(profile.tagline || profile.city) && (
              <p style={{ margin: "2px 0 0", opacity: 0.75 }}>
                {[profile.tagline, profile.city].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        {profile.description && (
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, opacity: 0.85, margin: "18px 0 0" }}>
            {profile.description}
          </p>
        )}

        {(links.length > 0 || profile.contactEmail || profile.phone) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {links.map(([k, label]) => (
              <a key={k} href={profile[k]!} target="_blank" rel="noreferrer" style={pill(accent)}>
                {label} ↗
              </a>
            ))}
            {profile.contactEmail && (
              <a href={`mailto:${profile.contactEmail}`} style={pill(accent)}>
                ✉ {profile.contactEmail}
              </a>
            )}
            {profile.phone && (
              <a href={`tel:${profile.phone.replace(/\s+/g, "")}`} style={pill(accent)}>
                ☎ {profile.phone}
              </a>
            )}
          </div>
        )}
      </header>

      <EventsBrowser slug={slug} events={events} past={past} accent={accent} />
    </main>
    </div>
  );
}

const pill = (accent: string): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 999,
  border: `1px solid ${accent}55`,
  color: accent,
  textDecoration: "none",
  fontSize: 13,
});
