"use client";

import { useEffect, useState } from "react";
import {
  createVenue,
  type EventData,
  type EventDetail,
  listVenues,
  updateEvent,
  updateVenue,
  type Venue,
} from "../lib/api";
import { fromLocalInput, TIMEZONES, toLocalInput } from "../lib/time";
import { ModeOption } from "./EventsList";
import ImageField from "./ImageField";

const CATEGORIES = ["Concierto", "Festival", "Teatro", "Danza", "Humor", "Deporte", "Conferencia", "Fiesta", "Familiar", "Otro"];

type VenueForm = { name: string; address: string; city: string; postalCode: string; mapsUrl: string };
const emptyVenue: VenueForm = { name: "", address: "", city: "", postalCode: "", mapsUrl: "" };
const venueForm = (v: Venue | null | undefined): VenueForm =>
  v
    ? { name: v.name, address: v.address ?? "", city: v.city ?? "", postalCode: v.postalCode ?? "", mapsUrl: v.mapsUrl ?? "" }
    : emptyVenue;

/** Estado del formulario: todo como texto, tal cual lo editan los inputs. */
function toForm(ev: EventData) {
  const tz = ev.timezone;
  return {
    name: ev.name,
    summary: ev.summary ?? "",
    description: ev.description ?? "",
    category: ev.category ?? "",
    imageUrl: ev.imageUrl ?? "",
    timezone: tz,
    startsAt: toLocalInput(ev.startsAt, tz),
    endsAt: toLocalInput(ev.endsAt, tz),
    doorsAt: toLocalInput(ev.doorsAt, tz),
    visibility: ev.visibility,
    seatingMode: ev.seatingMode,
    salesStartAt: toLocalInput(ev.salesStartAt, tz),
    salesEndAt: toLocalInput(ev.salesEndAt, tz),
    maxPerOrder: String(ev.maxPerOrder),
    minAge: ev.minAge == null ? "" : String(ev.minAge),
    refundPolicy: ev.refundPolicy ?? "",
    contactEmail: ev.contactEmail ?? "",
    confirmationMessage: ev.confirmationMessage ?? "",
  };
}

export default function EventDetailsForm({
  token,
  detail,
  disabled,
  onSaved,
}: {
  token: string;
  detail: EventDetail;
  disabled: boolean;
  onSaved: (d: EventDetail) => void;
}) {
  const [f, setF] = useState(() => toForm(detail.event));
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string>(detail.event.venueId ?? "");
  const [venue, setVenue] = useState<VenueForm>(venueForm(detail.venue));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    listVenues(token).then(setVenues).catch(() => {});
  }, [token]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const setV = (k: keyof VenueForm, v: string) => setVenue((p) => ({ ...p, [k]: v }));
  const hasSales = detail.stats.sold > 0;
  const tz = f.timezone;

  function pickVenue(id: string) {
    setVenueId(id);
    setVenue(id === "new" ? emptyVenue : venueForm(venues.find((v) => v.id === id)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      // Recinto: alta si es nuevo; si es uno existente y se ha tocado, se actualiza.
      let vId: string | null = venueId && venueId !== "new" ? venueId : null;
      const venueData = {
        name: venue.name,
        address: venue.address || null,
        city: venue.city || null,
        postalCode: venue.postalCode || null,
        mapsUrl: venue.mapsUrl || null,
      };
      if (venueId === "new" && venue.name.trim()) {
        vId = (await createVenue(token, venueData)).id;
      } else if (vId) {
        const original = venueForm(venues.find((v) => v.id === vId) ?? detail.venue);
        if (JSON.stringify(original) !== JSON.stringify(venue)) await updateVenue(token, vId, venueData);
      }

      const saved = await updateEvent(token, detail.event.id, {
        name: f.name,
        summary: f.summary || null,
        description: f.description || null,
        category: f.category || null,
        imageUrl: f.imageUrl || null,
        timezone: tz,
        startsAt: fromLocalInput(f.startsAt, tz),
        endsAt: fromLocalInput(f.endsAt, tz),
        doorsAt: fromLocalInput(f.doorsAt, tz),
        visibility: f.visibility,
        ...(detail.mixed ? {} : { seatingMode: f.seatingMode }),
        salesStartAt: fromLocalInput(f.salesStartAt, tz),
        salesEndAt: fromLocalInput(f.salesEndAt, tz),
        maxPerOrder: Number(f.maxPerOrder),
        minAge: f.minAge === "" ? null : Number(f.minAge),
        refundPolicy: f.refundPolicy || null,
        contactEmail: f.contactEmail || null,
        confirmationMessage: f.confirmationMessage || null,
        venueId: vId,
      });
      onSaved(saved);
      setF(toForm(saved.event));
      setVenueId(saved.event.venueId ?? "");
      setVenues(await listVenues(token));
      setMsg({ ok: true, text: "Cambios guardados." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <section className="card stack">
          <h3 className="section-title">Información básica</h3>
          <label className="field">
            Nombre
            <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
          </label>
          <label className="field">
            Resumen
            <input
              className="input"
              value={f.summary}
              onChange={(e) => set("summary", e.target.value)}
              maxLength={280}
              placeholder="Una frase que aparece en el listado"
            />
          </label>
          <div className="grid2">
            <label className="field">
              Categoría
              <select className="select" value={f.category} onChange={(e) => set("category", e.target.value)}>
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <ImageField
            token={token}
            kind="event"
            label="Imagen del evento"
            hint="Cartel o foto. Horizontal, recomendado 1600×800. JPG, PNG o WebP hasta 10 MB."
            value={f.imageUrl}
            onChange={(url) => set("imageUrl", url)}
            aspect="2 / 1"
          />
          <label className="field">
            Descripción
            <textarea
              className="textarea"
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              rows={6}
              placeholder="Programa, artistas, qué incluye la entrada…"
            />
          </label>
        </section>

        <section className="card stack">
          <h3 className="section-title">Fecha y hora</h3>
          <div className="grid2">
            <label className="field">
              Zona horaria
              <select className="select" value={tz} onChange={(e) => set("timezone", e.target.value)}>
                {[...new Set([tz, ...TIMEZONES])].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
              <span className="hint">Las horas de abajo están en esta zona.</span>
            </label>
            <label className="field">
              Inicio
              <input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </label>
            <label className="field">
              Fin
              <input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </label>
            <label className="field">
              Apertura de puertas
              <input className="input" type="datetime-local" value={f.doorsAt} onChange={(e) => set("doorsAt", e.target.value)} />
            </label>
          </div>
        </section>

        <section className="card stack">
          <h3 className="section-title">Lugar</h3>
          <label className="field">
            Recinto
            <select className="select" value={venueId} onChange={(e) => pickVenue(e.target.value)}>
              <option value="">— Elige un recinto —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.city ? ` (${v.city})` : ""}
                </option>
              ))}
              <option value="new">+ Nuevo recinto…</option>
            </select>
          </label>
          {venueId && (
            <>
              <div className="grid2">
                <label className="field">
                  Nombre del recinto
                  <input className="input" value={venue.name} onChange={(e) => setV("name", e.target.value)} required />
                </label>
                <label className="field">
                  Dirección
                  <input className="input" value={venue.address} onChange={(e) => setV("address", e.target.value)} />
                </label>
                <label className="field">
                  Ciudad
                  <input className="input" value={venue.city} onChange={(e) => setV("city", e.target.value)} />
                </label>
                <label className="field">
                  Código postal
                  <input className="input" value={venue.postalCode} onChange={(e) => setV("postalCode", e.target.value)} />
                </label>
              </div>
              <label className="field">
                Enlace al mapa
                <input
                  className="input"
                  type="url"
                  value={venue.mapsUrl}
                  onChange={(e) => setV("mapsUrl", e.target.value)}
                  placeholder="https://maps.google.com/…"
                />
              </label>
              {venueId !== "new" && (
                <span className="faint">Los cambios del recinto se aplican a todos los eventos que lo usan.</span>
              )}
            </>
          )}
        </section>

        <section className="card stack">
          <h3 className="section-title">Venta</h3>
          {detail.mixed ? (
            <div className="field">
              Tipo de aforo
              <div className="notice ok" style={{ margin: 0 }}>
                <strong>Mixto:</strong> este evento vende entradas con asiento (plano) y sin asiento (aforo). Se
                configura en cada tipo de entrada, pestaña «Entradas».
              </div>
            </div>
          ) : (
          <div className="field">
            Tipo de aforo
            <div className="grid2">
              <ModeOption
                checked={f.seatingMode === "GENERAL"}
                onChange={() => set("seatingMode", "GENERAL")}
                disabled={hasSales}
                title="Entrada general"
                text="Aforo por tipo de entrada, sin asientos."
              />
              <ModeOption
                checked={f.seatingMode === "RESERVED"}
                onChange={() => set("seatingMode", "RESERVED")}
                disabled={hasSales}
                title="Asientos numerados"
                text="El comprador elige butaca en el plano."
              />
            </div>
            <span className="hint">
              {hasSales
                ? "Ya hay ventas: el tipo de aforo no se puede cambiar."
                : "Cambiarlo borra el plano o el aforo actual. Para mezclar (p. ej. platea numerada + pista), elige el tipo en cada entrada."}
            </span>
          </div>
          )}
          <div className="field">
            Visibilidad
            <div className="row">
              <label className="check">
                <input type="radio" checked={f.visibility === "PUBLIC"} onChange={() => set("visibility", "PUBLIC")} />
                Público (aparece en tu página)
              </label>
              <label className="check">
                <input type="radio" checked={f.visibility === "UNLISTED"} onChange={() => set("visibility", "UNLISTED")} />
                Oculto (solo con el enlace)
              </label>
            </div>
          </div>
          <div className="grid2">
            <label className="field">
              Inicio de la venta online
              <input className="input" type="datetime-local" value={f.salesStartAt} onChange={(e) => set("salesStartAt", e.target.value)} />
              <span className="hint">Vacío: desde que publicas.</span>
            </label>
            <label className="field">
              Fin de la venta online
              <input className="input" type="datetime-local" value={f.salesEndAt} onChange={(e) => set("salesEndAt", e.target.value)} />
              <span className="hint">Vacío: hasta el final del evento. La taquilla puede vender igualmente.</span>
            </label>
            <label className="field">
              Máximo de entradas por pedido
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={f.maxPerOrder}
                onChange={(e) => set("maxPerOrder", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="card stack">
          <h3 className="section-title">Condiciones y comunicación</h3>
          <div className="grid2">
            <label className="field">
              Edad mínima
              <select className="select" value={f.minAge} onChange={(e) => set("minAge", e.target.value)}>
                <option value="">Todos los públicos</option>
                {[12, 14, 16, 18, 21].map((a) => (
                  <option key={a} value={a}>
                    +{a}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Email de contacto
              <input
                className="input"
                type="email"
                value={f.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                placeholder="info@tupromotora.com"
              />
              <span className="hint">Se muestra al comprador y en el email de las entradas.</span>
            </label>
          </div>
          <label className="field">
            Política de devoluciones
            <textarea
              className="textarea"
              value={f.refundPolicy}
              onChange={(e) => set("refundPolicy", e.target.value)}
              placeholder="Ej.: no se admiten devoluciones salvo cancelación del evento."
            />
          </label>
          <label className="field">
            Mensaje de confirmación
            <textarea
              className="textarea"
              value={f.confirmationMessage}
              onChange={(e) => set("confirmationMessage", e.target.value)}
              placeholder="Se muestra tras la compra y en el email: cómo llegar, qué traer…"
            />
          </label>
        </section>
      </fieldset>

      {msg && <div className={`notice ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
      {!disabled && (
        <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
          <button className="btn success" disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}
    </form>
  );
}
