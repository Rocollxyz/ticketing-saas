"use client";

import { Calendar, MapPin, Search, Star, Ticket } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { euros, formatDate, type PastEvent, type ShopEvent } from "../../lib/api";

type When = "all" | "week" | "month" | "next";

const WHEN_LABEL: Record<When, string> = {
  all: "Todas las fechas",
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

/** Día y mes abreviado para la etiqueta del cartel ("24" / "oct"). */
function dayMonth(iso: string | null, tz: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("es-ES", { timeZone: tz, day: "numeric" }).format(d),
    month: new Intl.DateTimeFormat("es-ES", { timeZone: tz, month: "short" }).format(d).replace(".", ""),
  };
}

/** Cartel del evento o, si no tiene, el color de marca (con un icono encima). */
const imgStyle = (url: string | null) => (url ? { backgroundImage: `url("${url}")` } : undefined);

/** Precio o estado de venta de un evento. */
function priceLabel(e: ShopEvent) {
  if (e.soldOut) return <span style={{ color: "var(--danger)" }}>Agotado</span>;
  if (!e.salesOpen) return <span style={{ color: "var(--warn)" }}>{e.salesMessage}</span>;
  if (e.allFree) return "Gratis";
  if (e.fromCents != null) return `Desde ${euros(e.fromCents)}`;
  return null;
}

/**
 * Cartelera del promotor: evento destacado (el próximo a la venta), filtros en botones y
 * rejilla de carteles. Todo en el navegador: un promotor tiene pocos eventos a la vez.
 */
export default function EventsBrowser({
  base,
  events,
  past,
}: {
  /** Ruta base de los enlaces: `/promotor` o `/embed/promotor` (módulo incrustado). */
  base: string;
  events: ShopEvent[];
  past: PastEvent[];
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
  // Incrustada: la ficha sabe que viene de la cartelera para ofrecer «volver».
  const eventHref = (id: string) => `${base}/event/${id}${base.startsWith("/embed/") ? "?desde=cartelera" : ""}`;
  const filtering = !!(query || category || city || when !== "all");
  const shown = events.filter(
    (e) =>
      (!category || e.category === category) &&
      (!city || e.venueCity === city) &&
      matchesWhen(e, when, now) &&
      (!query || norm([e.name, e.summary, e.venueName, e.venueCity].filter(Boolean).join(" ")).includes(query)),
  );
  // Destacado: el próximo que se puede comprar (solo sin filtros, para no esconder resultados).
  const featured = filtering ? null : (events.find((e) => e.salesOpen && !e.soldOut && e.startsAt) ?? null);
  const grid = featured ? shown.filter((e) => e.id !== featured.id) : shown;

  const reset = () => {
    setQ("");
    setCategory(null);
    setCity(null);
    setWhen("all");
  };

  return (
    <div>
      {featured && (
        <Link href={eventHref(featured.id)} className="featured">
          <div className={`featured-img ${featured.imageUrl ? "" : "no-img"}`} style={imgStyle(featured.imageUrl)}>
            {!featured.imageUrl && <Ticket size={44} />}
          </div>
          <div className="featured-body">
            <span className="badge-soft">
              <Star size={14} /> Próximo evento
            </span>
            <h3>{featured.name}</h3>
            {featured.summary && <p style={{ margin: 0, color: "var(--muted)" }}>{featured.summary}</p>}
            <span className="ev-fact" style={{ fontSize: 15 }}>
              <Calendar size={17} /> {formatDate(featured.startsAt, featured.timezone, { long: true })}
            </span>
            {featured.venueName && (
              <span className="ev-fact" style={{ fontSize: 15 }}>
                <MapPin size={17} /> {[featured.venueName, featured.venueCity].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className="ev-card-price" style={{ fontSize: 16 }}>{priceLabel(featured)}</span>
            <span className="btn-primary">Comprar entradas</span>
          </div>
        </Link>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{featured ? "Toda la cartelera" : "Próximos eventos"}</h2>
        <span style={{ fontSize: 13, color: "var(--faint)" }}>
          {filtering ? `${shown.length} de ${events.length}` : `${events.length} evento${events.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {events.length > 1 && (
        <div className="toolbar">
          <label className="search">
            <Search size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar evento, artista, sala…" aria-label="Buscar" />
          </label>
          <div className="chips" role="group" aria-label="Fecha">
            {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
              <button key={w} className="chip" aria-pressed={when === w} onClick={() => setWhen(w)}>
                {WHEN_LABEL[w]}
              </button>
            ))}
          </div>
          {(categories.length > 1 || cities.length > 1) && (
            <div className="chips">
              {categories.length > 1 &&
                categories.map((c) => (
                  <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
                    {c}
                  </button>
                ))}
              {cities.length > 1 &&
                cities.map((c) => (
                  <button key={c} className="chip" aria-pressed={city === c} onClick={() => setCity(city === c ? null : c)}>
                    <MapPin size={13} /> {c}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {events.length === 0 && <p style={{ color: "var(--muted)" }}>No hay eventos a la venta ahora mismo.</p>}
      {events.length > 0 && shown.length === 0 && (
        <p style={{ color: "var(--muted)" }}>
          Ningún evento coincide con la búsqueda.{" "}
          <button className="btn-link" onClick={reset}>
            Quitar filtros
          </button>
        </p>
      )}

      {grid.length > 0 && (
        <div className="ev-cards" style={{ marginTop: events.length > 1 ? 0 : 16 }}>
          {grid.map((e) => {
            const dm = dayMonth(e.startsAt, e.timezone);
            return (
              <Link key={e.id} href={eventHref(e.id)} className="ev-card">
                <div className={`ev-card-img ${e.imageUrl ? "" : "no-img"}`} style={imgStyle(e.imageUrl)}>
                  {!e.imageUrl && <Ticket size={36} />}
                  {dm && (
                    <span className="date-badge">
                      <b>{dm.day}</b>
                      <span>{dm.month}</span>
                    </span>
                  )}
                  {e.soldOut && <span className="ribbon out">Agotado</span>}
                </div>
                <div className="ev-card-body">
                  {e.category && <span className="badge-soft" style={{ fontSize: 11 }}>{e.category}</span>}
                  <strong>{e.name}</strong>
                  <span className="ev-card-meta">{formatDate(e.startsAt, e.timezone)}</span>
                  {e.venueName && <span className="ev-card-meta">{[e.venueName, e.venueCity].filter(Boolean).join(" · ")}</span>}
                  {!e.soldOut && <span className="ev-card-price">{priceLabel(e)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {past.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 12px", color: "var(--muted)" }}>Eventos pasados</h2>
          <div className="past">
            {past.map((e) => (
              <div key={e.id} className="ev-card" style={{ cursor: "default" }}>
                <div className={`ev-card-img ${e.imageUrl ? "" : "no-img"}`} style={imgStyle(e.imageUrl)} />
                <div className="ev-card-body">
                  <span className="ev-card-meta" style={{ fontSize: 12 }}>
                    {formatDate(e.startsAt, e.timezone)}
                  </span>
                  <strong style={{ fontSize: 14 }}>{e.name}</strong>
                  {e.venueName && <span className="ev-card-meta" style={{ fontSize: 12 }}>{e.venueName}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
