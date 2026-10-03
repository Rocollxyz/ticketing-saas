"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { accentOf, API_URL, type EventDetail, euros, formatDate, type ShopTicketType } from "../../../../lib/api";
import {
  connectToEvent,
  type HeldPayload,
  type SeatIdsPayload,
  SEATS_HELD,
  SEATS_RELEASED,
  SEATS_SOLD,
} from "../../../../lib/realtime";

interface CheckoutData {
  clientSecret: string;
  publishableKey: string;
}

/** Reserva en curso: las entradas están bloqueadas para este comprador hasta `deadline`. */
interface ActiveHold {
  id: string;
  /** Instante local (ms) en que caduca, corregido con la hora del servidor. */
  deadline: number;
}

const card: React.CSSProperties = { background: "#171a21", borderRadius: 10, padding: 16, border: "1px solid #232833" };
const muted: React.CSSProperties = { fontSize: 14, color: "#9aa3b2" };

export default function EventClient({ slug, detail: initial }: { slug: string; detail: EventDetail }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const { event: ev, venue, sales } = detail;
  const general = ev.seatingMode === "GENERAL";

  const [selected, setSelected] = useState<Set<string>>(new Set()); // numerado: asientos
  const [qty, setQty] = useState<Record<string, number>>({}); // general: cantidades
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [hold, setHold] = useState<ActiveHold | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [email, setEmail] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // sessionId estable de esta pestaña: lo enviamos al reservar para que el servidor
  // marque el `actor` y así NO nos auto-bloqueemos con nuestro propio seats.held.
  const sessionId = useRef<string>("");
  if (!sessionId.current) {
    sessionId.current =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  }

  // Disponibilidad en vivo (numerado). `unavailable` = no seleccionable (reservado por
  // otro o vendido); `sold` = vendido definitivo (solo para el estilo).
  const [unavailable, setUnavailable] = useState<Set<string>>(
    () => new Set(initial.seats.filter((s) => !s.disponible).map((s) => s.id)),
  );
  const [sold, setSold] = useState<Set<string>>(new Set());

  // Entrada general: las plazas concretas no se muestran; ante cualquier cambio se
  // recarga la disponibilidad por categoría (agrupado para no saturar).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      const r = await fetch(`${API_URL}/shop/${slug}/events/${ev.id}`, { cache: "no-store" });
      if (r.ok) setDetail(await r.json());
    }, 400);
  }, [slug, ev.id]);

  useEffect(() => {
    const socket = connectToEvent(ev.id);
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));

    const drop = (ids: string[]) =>
      setSelected((prev) => {
        if (!ids.some((id) => prev.has(id))) return prev;
        const next = new Set(prev); // alguien se nos adelantó: lo quitamos
        ids.forEach((id) => next.delete(id));
        return next;
      });

    socket.on(SEATS_HELD, ({ seatIds, actor }: HeldPayload) => {
      if (actor === sessionId.current) return; // es nuestra propia reserva
      if (general) return refresh();
      setUnavailable((prev) => new Set([...prev, ...seatIds]));
      drop(seatIds);
    });
    socket.on(SEATS_RELEASED, ({ seatIds }: SeatIdsPayload) => {
      if (general) return refresh();
      setUnavailable((prev) => {
        const next = new Set(prev);
        seatIds.forEach((id) => next.delete(id));
        return next;
      });
      setSold((prev) => {
        if (!seatIds.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        seatIds.forEach((id) => next.delete(id));
        return next;
      });
    });
    socket.on(SEATS_SOLD, ({ seatIds }: SeatIdsPayload) => {
      if (general) return refresh();
      setUnavailable((prev) => new Set([...prev, ...seatIds]));
      setSold((prev) => new Set([...prev, ...seatIds]));
      drop(seatIds);
    });
    return () => {
      socket.disconnect();
    };
  }, [ev.id, general, refresh]);

  const typeById = useMemo(() => new Map(detail.ticketTypes.map((t) => [t.id, t])), [detail.ticketTypes]);

  const count = general ? Object.values(qty).reduce((a, b) => a + b, 0) : selected.size;
  const total = general
    ? Object.entries(qty).reduce((acc, [id, n]) => acc + n * (typeById.get(id)?.precioCents ?? 0), 0)
    : detail.seats.filter((s) => selected.has(s.id)).reduce((acc, s) => acc + (s.precioCents ?? 0), 0);

  // Reglas del pedido (la API las vuelve a comprobar).
  const ruleError = useMemo(() => {
    if (count > ev.maxPerOrder) return `Máximo ${ev.maxPerOrder} entradas por pedido`;
    const perType = new Map<string, number>();
    if (general) Object.entries(qty).forEach(([id, n]) => n && perType.set(id, n));
    else
      detail.seats
        .filter((s) => selected.has(s.id) && s.ticketTypeId)
        .forEach((s) => perType.set(s.ticketTypeId!, (perType.get(s.ticketTypeId!) ?? 0) + 1));
    for (const [id, n] of perType) {
      const t = typeById.get(id);
      if (!t) continue;
      if (n < t.minPerOrder) return `${t.name}: mínimo ${t.minPerOrder} por pedido`;
      if (t.maxPerOrder != null && n > t.maxPerOrder) return `${t.name}: máximo ${t.maxPerOrder} por pedido`;
    }
    return null;
  }, [count, ev.maxPerOrder, general, qty, selected, detail.seats, typeById]);

  const canBuy = sales.open && count > 0 && emailOk && !ruleError && !loading;

  function toggle(seatId: string, isAvailable: boolean) {
    if (!isAvailable || hold) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(seatId) ? next.delete(seatId) : next.add(seatId);
      return next;
    });
  }

  async function comprar() {
    // Se valida ANTES de reservar: un email inválido no debe dejar asientos bloqueados.
    if (!emailOk) {
      setError("Introduce un email válido: te enviaremos ahí las entradas");
      return;
    }
    setLoading(true);
    setError(null);
    setExpired(false);
    let held: ActiveHold | null = null;
    try {
      const holdRes = await fetch(`${API_URL}/shop/${slug}/holds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: ev.id,
          sessionId: sessionId.current,
          ...(general
            ? { quantities: Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0)) }
            : { seatIds: [...selected] }),
        }),
      });
      if (!holdRes.ok) {
        const body = await holdRes.json().catch(() => null);
        if (general) refresh();
        throw new Error(body?.message ?? "Alguna entrada ya no está disponible");
      }
      const h = await holdRes.json();
      // Tiempo restante según el SERVIDOR (el reloj del comprador puede ir mal).
      const remaining = new Date(h.expiresAt).getTime() - new Date(h.serverNow).getTime();
      held = { id: h.holdId, deadline: Date.now() + remaining };

      const coRes = await fetch(`${API_URL}/shop/${slug}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holdId: h.holdId, buyerEmail: email.trim() }),
      });
      if (!coRes.ok) {
        const body = await coRes.json().catch(() => null);
        throw new Error(body?.message ?? "No se pudo iniciar el pago");
      }
      const co = await coRes.json();
      // Pedido gratuito: ya está emitido, no hay pago.
      if (co.free) return router.push(`/${slug}/success?event=${ev.id}`);
      setHold(held);
      setCheckout({ clientSecret: co.clientSecret, publishableKey: co.publishableKey });
    } catch (e) {
      // Si la reserva se hizo pero el pago no arrancó, se suelta para no bloquear plazas.
      if (held) void releaseHold(held.id);
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function releaseHold(id: string) {
    await fetch(`${API_URL}/shop/${slug}/holds/${id}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId.current }),
    }).catch(() => {});
  }

  /** "Cambiar selección": suelta la reserva (y cancela el cobro iniciado). */
  async function changeSelection() {
    if (!hold) return;
    setLoading(true);
    await releaseHold(hold.id);
    setHold(null);
    setCheckout(null);
    setLoading(false);
    if (general) refresh();
  }

  /** Se acabó el tiempo: fuera el pago; el servidor libera las plazas. */
  const onExpire = useCallback(() => {
    setHold(null);
    setCheckout(null);
    setExpired(true);
    if (general) setTimeout(refresh, 25_000); // tras el barrido del servidor
  }, [general, refresh]);

  const stripePromise = useMemo(() => (checkout ? loadStripe(checkout.publishableKey) : null), [checkout]);

  return (
    <main>
      <a href={`/${slug}`} style={{ color: "#5b9dff" }}>
        ← {detail.organizer ? `Más eventos de ${detail.organizer.name}` : "Todos los eventos"}
      </a>

      {ev.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ev.imageUrl}
          alt=""
          style={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 12, marginTop: 16 }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <span style={{ fontSize: 12, color: "#5b9dff", textTransform: "uppercase", letterSpacing: 1 }}>
          {ev.category}
        </span>
        {sales.open && (
          <span style={{ fontSize: 13, color: live ? "#3ecf8e" : "#7a8190" }}>
            {live ? "● en vivo" : "○ conectando…"}
          </span>
        )}
      </div>
      <h1 style={{ margin: "4px 0 8px" }}>{ev.name}</h1>
      {ev.summary && <p style={{ ...muted, fontSize: 16, marginTop: 0 }}>{ev.summary}</p>}

      <div style={{ ...card, display: "grid", gap: 6, fontSize: 15 }}>
        <span>
          📅 {formatDate(ev.startsAt, ev.timezone, { long: true })}
          {ev.doorsAt && <span style={muted}> · puertas {formatDate(ev.doorsAt, ev.timezone, { timeOnly: true })}</span>}
        </span>
        {venue && (
          <span>
            📍 {venue.name}
            {(venue.address || venue.city) && (
              <span style={muted}> · {[venue.address, venue.postalCode, venue.city].filter(Boolean).join(", ")}</span>
            )}
            {venue.mapsUrl && (
              <>
                {" · "}
                <a href={venue.mapsUrl} target="_blank" rel="noreferrer" style={{ color: "#5b9dff" }}>
                  ver mapa
                </a>
              </>
            )}
          </span>
        )}
        {ev.minAge != null && <span>🔞 Edad mínima: {ev.minAge} años</span>}
        {detail.organizer && (
          <a
            href={`/${slug}`}
            style={{ display: "flex", alignItems: "center", gap: 8, color: "inherit", textDecoration: "none", marginTop: 4 }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: detail.organizer.logoUrl
                  ? `center/cover url("${detail.organizer.logoUrl}") #fff`
                  : accentOf(detail.organizer),
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {!detail.organizer.logoUrl && detail.organizer.name[0]?.toUpperCase()}
            </span>
            <span style={muted}>
              Organiza <strong style={{ color: "#e9edf2" }}>{detail.organizer.name}</strong>
            </span>
          </a>
        )}
      </div>

      {!sales.open && (
        <p
          style={{
            ...card,
            marginTop: 16,
            color: ev.status === "CANCELLED" ? "#ff6b6b" : "#e0a23c",
            fontWeight: 600,
          }}
        >
          {sales.message}
          {sales.from && ` (a partir del ${formatDate(sales.from, ev.timezone)})`}
        </p>
      )}

      {sales.open && (
        <section style={{ margin: "20px 0" }}>
          <h2 style={{ fontSize: 18 }}>Entradas</h2>
          {general ? (
            <div style={{ display: "grid", gap: 10 }}>
              {detail.ticketTypes.map((t) => (
                <QuantityRow
                  key={t.id}
                  t={t}
                  tz={ev.timezone}
                  value={qty[t.id] ?? 0}
                  disabled={!!hold}
                  onChange={(n) => setQty((p) => ({ ...p, [t.id]: n }))}
                />
              ))}
            </div>
          ) : (
            <SeatMap
              detail={detail}
              selected={selected}
              unavailable={unavailable}
              sold={sold}
              locked={!!hold}
              onToggle={toggle}
            />
          )}
        </section>
      )}

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

      {sales.open && !hold && !expired && (
        <>
          <label style={{ display: "block", marginBottom: 16, fontSize: 14 }}>
            Email (recibirás aquí tus entradas)
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${email && !emailOk ? "#ff6b6b" : "#2b313c"}`,
                background: "#171a21",
                color: "#e9edf2",
                fontSize: 15,
                boxSizing: "border-box",
              }}
            />
          </label>
          {ruleError && <p style={{ color: "#e0a23c", fontSize: 14 }}>{ruleError}</p>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>
              Total: {count === 0 ? "—" : euros(total)}
              {count > 0 && <span style={{ ...muted, fontWeight: 400 }}> · {count} entrada(s)</span>}
            </strong>
            <button
              onClick={comprar}
              disabled={!canBuy}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                border: "none",
                background: canBuy ? "#5b9dff" : "#2b313c",
                color: "#fff",
                fontSize: 16,
                cursor: canBuy ? "pointer" : "not-allowed",
              }}
            >
              {loading ? "Procesando…" : total === 0 && count > 0 ? "Reservar gratis" : "Comprar"}
            </button>
          </div>
        </>
      )}

      {expired && (
        <div style={{ ...card, borderColor: "#e0a23c", margin: "16px 0" }}>
          <strong style={{ color: "#e0a23c" }}>⏱ Se ha agotado el tiempo de reserva</strong>
          <p style={{ ...muted, margin: "6px 0 12px" }}>
            Tus entradas se han liberado y no se ha realizado ningún cobro. Puedes volver a intentarlo si siguen
            disponibles.
          </p>
          <button
            onClick={() => setExpired(false)}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #2b313c", background: "#1d2b45", color: "#e9edf2", cursor: "pointer" }}
          >
            Volver a intentarlo
          </button>
        </div>
      )}

      {hold && <HoldTimer deadline={hold.deadline} onExpire={onExpire} onChange={changeSelection} busy={loading} />}

      {checkout && hold && stripePromise && (
        <Elements stripe={stripePromise} options={{ clientSecret: checkout.clientSecret }}>
          <PaymentForm slug={slug} eventId={ev.id} total={total} email={email.trim()} deadline={hold.deadline} />
        </Elements>
      )}

      {ev.description && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18 }}>Información</h2>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, opacity: 0.9 }}>{ev.description}</p>
        </section>
      )}

      {(ev.refundPolicy || ev.contactEmail) && (
        <section style={{ ...card, marginTop: 24, display: "grid", gap: 8, fontSize: 14 }}>
          {ev.refundPolicy && (
            <div>
              <strong>Devoluciones</strong>
              <p style={{ ...muted, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{ev.refundPolicy}</p>
            </div>
          )}
          {ev.contactEmail && (
            <div>
              <strong>Contacto</strong>{" "}
              <a href={`mailto:${ev.contactEmail}`} style={{ color: "#5b9dff" }}>
                {ev.contactEmail}
              </a>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/**
 * Cuenta atrás de la reserva. Fija arriba mientras se paga: deja claro cuánto tiempo
 * quedan bloqueadas las entradas y permite soltarlas para cambiar la selección.
 */
function HoldTimer({
  deadline,
  onExpire,
  onChange,
  busy,
}: {
  deadline: number;
  onExpire: () => void;
  onChange: () => void;
  busy: boolean;
}) {
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now());
      setLeft(ms);
      if (ms === 0) onExpire();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, onExpire]);

  const secs = Math.ceil(left / 1000);
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const urgent = secs <= 120;
  return (
    <div
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "16px 0",
        padding: "12px 16px",
        borderRadius: 10,
        background: urgent ? "#3a2a12" : "#16233a",
        border: `1px solid ${urgent ? "#e0a23c" : "#2b4a7a"}`,
      }}
    >
      <span style={{ fontSize: 26, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: urgent ? "#e0a23c" : "#e9edf2" }}>
        {mmss}
      </span>
      <span style={{ flex: 1, fontSize: 14, color: urgent ? "#f0c27a" : "#9fb4cc" }}>
        {urgent
          ? "¡Date prisa! Si se acaba el tiempo, tus entradas se liberarán."
          : "Tus entradas están reservadas mientras completas el pago."}
      </span>
      <button
        onClick={onChange}
        disabled={busy}
        style={{ background: "none", border: "none", color: "#5b9dff", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
      >
        Cambiar selección
      </button>
    </div>
  );
}

function QuantityRow({
  t,
  tz,
  value,
  disabled,
  onChange,
}: {
  t: ShopTicketType;
  tz: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const max = Math.min(t.disponibles, t.maxPerOrder ?? Infinity);
  const soldOut = t.disponibles === 0;
  const blocked = disabled || soldOut || !t.salesOpen;
  const step = (d: number) => {
    let n = value + d;
    // Si hay mínimo por pedido, se salta de 0 al mínimo y viceversa.
    if (d > 0 && value === 0) n = Math.max(1, t.minPerOrder);
    if (d < 0 && value <= t.minPerOrder) n = 0;
    onChange(Math.max(0, Math.min(max, n)));
  };
  return (
    <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", opacity: blocked && !disabled ? 0.6 : 1 }}>
      <div style={{ flex: 1, display: "grid", gap: 2 }}>
        <strong>{t.name}</strong>
        {t.description && <span style={muted}>{t.description}</span>}
        <span style={{ fontSize: 13 }}>
          <strong>{euros(t.precioCents)}</strong>
          {t.regularCents != null && (
            <span style={muted}>
              {" "}
              · precio anticipado hasta {formatDate(t.priceEndsAt, tz)} (luego {euros(t.regularCents)})
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: soldOut ? "#ff6b6b" : !t.salesOpen ? "#e0a23c" : "#7a8190" }}>
          {soldOut
            ? "Agotadas"
            : !t.salesOpen
              ? t.salesMessage
              : t.disponibles <= 10
                ? `¡Últimas ${t.disponibles}!`
                : t.minPerOrder > 1
                  ? `Mínimo ${t.minPerOrder} por pedido`
                  : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Stepper label="−" onClick={() => step(-1)} disabled={blocked || value === 0} />
        <span style={{ minWidth: 20, textAlign: "center", fontSize: 18 }}>{value}</span>
        <Stepper label="+" onClick={() => step(1)} disabled={blocked || value >= max} />
      </div>
    </div>
  );
}

function Stepper({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label === "+" ? "Añadir" : "Quitar"}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: "1px solid #2b313c",
        background: disabled ? "transparent" : "#1d2b45",
        color: disabled ? "#4a5160" : "#e9edf2",
        fontSize: 18,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/** Plano posicional (numerado): posX = columna, posY = fila (0 = junto al escenario). */
function SeatMap({
  detail,
  selected,
  unavailable,
  sold,
  locked,
  onToggle,
}: {
  detail: EventDetail;
  selected: Set<string>;
  unavailable: Set<string>;
  sold: Set<string>;
  locked: boolean;
  onToggle: (id: string, available: boolean) => void;
}) {
  const placed = detail.seats.filter((s) => s.posX != null && s.posY != null);
  const unplaced = detail.seats.filter((s) => s.posX == null || s.posY == null);
  const cols = placed.length ? Math.max(...placed.map((s) => s.posX!)) + 1 : 1;
  const rows = placed.length ? Math.max(...placed.map((s) => s.posY!)) + 1 : 1;

  function renderSeat(s: (typeof detail.seats)[number], grid: boolean) {
    const isSel = selected.has(s.id);
    const isSold = sold.has(s.id);
    const isAvailable = !unavailable.has(s.id) && s.precioCents != null;
    return (
      <button
        key={s.id}
        onClick={() => onToggle(s.id, isAvailable)}
        disabled={!isAvailable || locked}
        title={`${s.fila}${s.numero} · ${s.categoria ?? ""} · ${euros(s.precioCents)}`}
        style={{
          gridColumnStart: grid ? s.posX! + 1 : undefined,
          gridRowStart: grid ? s.posY! + 1 : undefined,
          padding: "10px 6px",
          borderRadius: 8,
          border: isSel ? "2px solid #5b9dff" : "1px solid #2b313c",
          background: !isAvailable ? (isSold ? "#2a2030" : "#2b2718") : isSel ? "#1d2b45" : "#171a21",
          color: !isAvailable ? "#8a7d72" : "#e9edf2",
          cursor: isAvailable && !locked ? "pointer" : "not-allowed",
          fontSize: 13,
          transition: "background 0.25s, border-color 0.25s",
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {s.fila}
          {s.numero}
        </div>
        <div style={{ opacity: 0.7 }}>{s.categoria}</div>
        <div>{euros(s.precioCents)}</div>
        {!isAvailable && <div style={{ fontSize: 11 }}>{isSold ? "vendido" : "ocupado"}</div>}
      </button>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, ...muted, marginBottom: 12 }}>
        {detail.ticketTypes.map((t) => (
          <span key={t.id}>
            <strong style={{ color: "#e9edf2" }}>{t.name}</strong> {euros(t.precioCents)}
            {t.regularCents != null && ` (anticipada, luego ${euros(t.regularCents)})`}
            {!t.salesOpen && ` · ${t.salesMessage}`}
          </span>
        ))}
      </div>
      <div
        style={{
          textAlign: "center",
          padding: "6px 0",
          marginBottom: 16,
          borderRadius: 6,
          background: "linear-gradient(#23303f,#161d27)",
          color: "#9fb4cc",
          letterSpacing: 4,
          fontSize: 12,
        }}
      >
        ESCENARIO
      </div>
      {placed.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(56px, 1fr))`,
            gridTemplateRows: `repeat(${rows}, auto)`,
            gap: 10,
            justifyContent: "center",
          }}
        >
          {placed.map((s) => renderSeat(s, true))}
        </div>
      )}
      {unplaced.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: "#7a8190", marginTop: 16 }}>Sin ubicar en el plano:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{unplaced.map((s) => renderSeat(s, false))}</div>
        </>
      )}
    </div>
  );
}

function PaymentForm({
  slug,
  eventId,
  total,
  email,
  deadline,
}: {
  slug: string;
  eventId: string;
  total: number;
  email: string;
  deadline: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    if (Date.now() >= deadline) {
      setError("Se ha agotado el tiempo de reserva");
      return;
    }
    setPaying(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${slug}/success?event=${eventId}`,
      },
    });
    if (error) {
      setError(error.message ?? "El pago no se pudo completar");
      setPaying(false);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Pago — {euros(total)}</h2>
      <p style={{ fontSize: 13, color: "#7a8190" }}>Las entradas se enviarán a {email}</p>
      <PaymentElement />
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      <button
        onClick={pay}
        disabled={!stripe || paying}
        style={{
          marginTop: 16,
          padding: "12px 24px",
          borderRadius: 8,
          border: "none",
          background: "#3ecf8e",
          color: "#08130d",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {paying ? "Pagando…" : "Pagar"}
      </button>
    </div>
  );
}
