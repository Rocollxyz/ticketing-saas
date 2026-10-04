"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { euros, formatDate, type PastEvent, type ShopEvent } from "../../lib/api";

type When = "all" | "week" | "month" | "next";

const WHEN_LABEL: Record<When, string> = {
  all: "Cualquier fecha",
  week: "Próximos 7 días",
  month: "Este mes",
  next: "Mes que viene",
};

/** Mes (año*12+mes) de una fecha en la zona del evento, para filtrar "este mes". */
function monthKey(iso: string, tz: string) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" })
    .format(new Date(iso))
    .split("-")
    .map(Number);
  return y * 12 + m;
}

function matchesWhen(e: ShopEvent, when: When, now: Date) {
  if (when === "all") return true;
  if (!e.startsAt) return false;
  const start = new Date(e.startsAt);
  if (when === "week") return start.getTime() - now.getTime() <= 7 * 86_400_000;
  const current = monthKey(now.toISOString(), e.timezone);
  const key = monthKey(e.startsAt, e.timezone);
  return when === "month" ? key === current : key === current + 1;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Cartelera del promotor con buscador y filtros (todo en cliente: son pocos eventos). */
export default function EventsBrowser({
  slug,
  events,
  past,
  accent,
}: {
  slug: string;
  events: ShopEvent[];
  past: PastEvent[];
  accent: string;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [when, setWhen] = useState<When>("all");

  const categories = useMemo(
    () => [...new Set(events.map((e) => e.category).filter((c): c is string => !!c))].sort(),
    [events],
  );
  const cities = useMemo(
    () => [...new Set(events.map((e) => e.venueCity).filter((c): c is string => !!c))].sort(),
    [events],
  );

  const now = new Date();
  const query = norm(q.trim());
  const shown = events.filter(
    (e) =>
      (!category || e.category === category) &&
      (!city || e.venueCity === city) &&
      matchesWhen(e, when, now) &&
      (!query || norm([e.name, e.summary, e.venueName, e.venueCity].filter(Boolean).join(" ")).includes(query)),
  );
  const filtering = !!(query || category || city || when !== "all");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Próximos eventos</h2>
        <span style={{ fontSize: 13, opacity: 0.6 }}>
          {filtering ? `${shown.length} de ${events.length}` : `${events.length} evento(s)`}
        </span>
      </div>

      {events.length > 0 && (
        <div style={{ display: "grid", gap: 10, margin: "14px 0 18px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar evento, artista, sala…"
              aria-label="Buscar"
              style={{
                flex: 1,
                minWidth: 200,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 15,
              }}
            />
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value as When)}
              aria-label="Fecha"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 15,
              }}
            >
              {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
                <option key={w} value={w}>
                  {WHEN_LABEL[w]}
                </option>
              ))}
            </select>
          </div>
          {(categories.length > 1 || cities.length > 1) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {categories.length > 1 && (
                <>
                  <Chip active={!category} accent={accent} onClick={() => setCategory(null)}>
                    Todo
                  </Chip>
                  {categories.map((c) => (
                    <Chip key={c} active={category === c} accent={accent} onClick={() => setCategory(category === c ? null : c)}>
                      {c}
                    </Chip>
                  ))}
                </>
              )}
              {cities.length > 1 && (
                <>
                  <span style={{ width: 12 }} />
                  {cities.map((c) => (
                    <Chip key={c} active={city === c} accent={accent} onClick={() => setCity(city === c ? null : c)}>
                      📍 {c}
                    </Chip>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {events.length === 0 && <p style={{ opacity: 0.7 }}>No hay eventos a la venta ahora mismo.</p>}
      {events.length > 0 && shown.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          Ningún evento coincide con la búsqueda.{" "}
          <button
            onClick={() => {
              setQ("");
              setCategory(null);
              setCity(null);
              setWhen("all");
            }}
            style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 15, padding: 0 }}
          >
            Quitar filtros
          </button>
        </p>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {shown.map((e) => (
          <Link
            key={e.id}
            href={`/${slug}/event/${e.id}`}
            style={{
              display: "flex",
              gap: 16,
              background: "var(--surface)",
              borderRadius: 12,
              overflow: "hidden",
              color: "inherit",
              textDecoration: "none",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                width: 150,
                minHeight: 110,
                flexShrink: 0,
                background: e.imageUrl ? `center/cover url("${e.imageUrl}")` : `linear-gradient(135deg, ${accent}44, var(--stage-to))`,
              }}
            />
            <div style={{ padding: "14px 16px 14px 0", display: "grid", gap: 4, alignContent: "center" }}>
              <span style={{ fontSize: 12, color: accent, textTransform: "uppercase", letterSpacing: 1 }}>
                {formatDate(e.startsAt, e.timezone)}
                {e.category && <span style={{ opacity: 0.7 }}> · {e.category}</span>}
              </span>
              <strong style={{ fontSize: 18 }}>{e.name}</strong>
              {e.summary && <span style={{ fontSize: 14, opacity: 0.75 }}>{e.summary}</span>}
              <span style={{ fontSize: 13, opacity: 0.7 }}>{[e.venueName, e.venueCity].filter(Boolean).join(" · ")}</span>
              <span style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {e.soldOut ? (
                  <span style={{ color: "var(--danger)" }}>Agotado</span>
                ) : !e.salesOpen ? (
                  <span style={{ color: "var(--warn)" }}>{e.salesMessage}</span>
                ) : e.allFree ? (
                  "Gratis"
                ) : e.fromCents != null ? (
                  `Desde ${euros(e.fromCents)}`
                ) : null}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {past.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 18, opacity: 0.8 }}>Eventos pasados</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {past.map((e) => (
              <div
                key={e.id}
                style={{ background: "var(--surface)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", opacity: 0.75 }}
              >
                <div
                  style={{
                    height: 90,
                    background: e.imageUrl ? `center/cover url("${e.imageUrl}")` : "linear-gradient(135deg,var(--stage-from),var(--stage-to))",
                    filter: "grayscale(0.6)",
                  }}
                />
                <div style={{ padding: "10px 12px", display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{formatDate(e.startsAt, e.timezone)}</span>
                  <strong style={{ fontSize: 14 }}>{e.name}</strong>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{[e.venueName, e.venueCity].filter(Boolean).join(" · ")}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Chip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? accent : "var(--border)"}`,
        background: active ? `${accent}22` : "transparent",
        color: active ? accent : "var(--text)",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}
