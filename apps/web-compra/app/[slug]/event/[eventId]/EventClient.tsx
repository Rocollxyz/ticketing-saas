"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Clock,
  CreditCard,
  Mail,
  MapPin,
  Share2,
  ShieldCheck,
  Smartphone,
  Ticket,
  Undo2,
  X,
} from "lucide-react";
import {
  accentOf,
  API_URL,
  type AttendeeFieldPublic,
  type EventDetail,
  euros,
  fieldsFor,
  formatDate,
  inkFor,
  themeOf,
  type HeldSeat,
  type PaymentMethod,
  type ShopTicketType,
} from "../../../../lib/api";
import AttendeesForm from "./AttendeesForm";
import BillingBox, { billingComplete, type BillingInput, EMPTY_BILLING } from "./BillingBox";
import CouponBox, { type AppliedCoupon } from "./CouponBox";
import SeatMap from "./SeatMap";
import { inputStyle } from "./styles";
import {
  connectToEvent,
  type HeldPayload,
  type SeatIdsPayload,
  SEATS_HELD,
  SEATS_RELEASED,
  SEATS_SOLD,
} from "../../../../lib/realtime";

interface CheckoutData {
  /** Importe a cobrar ya con el descuento (lo calcula la API). */
  amountCents: number;
  clientSecret: string;
  publishableKey: string;
}

/** Reserva en curso: las entradas están bloqueadas para este comprador hasta `deadline`. */
interface ActiveHold {
  id: string;
  /** Instante local (ms) en que caduca, corregido con la hora del servidor. */
  deadline: number;
}

const muted: React.CSSProperties = { fontSize: 14, color: "var(--muted)" };

export default function EventClient({
  slug,
  detail: initial,
  embed = false,
  backToList = false,
}: {
  slug: string;
  detail: EventDetail;
  /** Incrustado en la web del promotor (iframe): sin salidas y la compra dentro del módulo. */
  embed?: boolean;
  /** Incrustado y abierto desde la cartelera incrustada: se ofrece volver a ella. */
  backToList?: boolean;
}) {
  const base = embed ? `/embed/${slug}` : `/${slug}`;
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const { event: ev, venue, sales } = detail;
  const sessions = detail.sessions ?? [];
  // Un evento puede mezclar categorías NUMERADAS (asiento en el plano) y GENERALES (por
  // cantidad), p. ej. platea + pista. (`seating` falta en APIs antiguas: manda el evento.)
  const seatingOf = (t: ShopTicketType) => t.seating ?? ev.seatingMode;
  const generalTypes = detail.ticketTypes.filter((t) => seatingOf(t) === "GENERAL");
  const hasGeneral = generalTypes.length > 0;
  const hasMap = detail.seats.length > 0;
  const mixed = hasGeneral && hasMap;

  const [selected, setSelected] = useState<Set<string>>(new Set()); // numerado: asientos
  // Generales: cantidades por categoría y tarifa (clave "categoría" o "categoría|tarifa").
  const [qty, setQty] = useState<Record<string, number>>({});
  // Numeradas: tarifa elegida por asiento (sin entrada = general).
  const [seatFare, setSeatFare] = useState<Record<string, string>>({});
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [hold, setHold] = useState<ActiveHold | null>(null);
  // Plazas reservadas pendientes de rellenar el formulario de asistentes.
  const [heldSeats, setHeldSeats] = useState<HeldSeat[] | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [email, setEmail] = useState("");
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const methods = detail.paymentMethods ?? ["card"];
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [billing, setBilling] = useState<BillingInput>(EMPTY_BILLING);
  // Con reserva: ¿ya pasó los datos del comprador? (luego vienen asistentes, si hay, y el pago)
  const [detailsDone, setDetailsDone] = useState(false);
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
  const [sold, setSold] = useState<Set<string>>(
    () => new Set(initial.seats.filter((s) => s.vendido).map((s) => s.id)),
  );

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
      if (hasGeneral) refresh();
      setUnavailable((prev) => new Set([...prev, ...seatIds]));
      drop(seatIds);
    });
    socket.on(SEATS_RELEASED, ({ seatIds }: SeatIdsPayload) => {
      if (hasGeneral) refresh();
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
      if (hasGeneral) refresh();
      setUnavailable((prev) => new Set([...prev, ...seatIds]));
      setSold((prev) => new Set([...prev, ...seatIds]));
      drop(seatIds);
    });
    return () => {
      socket.disconnect();
    };
  }, [ev.id, hasGeneral, refresh]);

  const typeById = useMemo(() => new Map(detail.ticketTypes.map((t) => [t.id, t])), [detail.ticketTypes]);

  /** Precio de una entrada de esa categoría con esa tarifa (sin tarifa, el de la categoría). */
  const priceOf = (typeId: string | null, fareId?: string | null) => {
    const t = typeId ? typeById.get(typeId) : undefined;
    const f = fareId ? t?.fares?.find((x) => x.id === fareId) : undefined;
    return (f ? f.precioCents : t?.precioCents) ?? 0;
  };
  const chosenSeats = detail.seats.filter((s) => selected.has(s.id));
  const count = selected.size + Object.values(qty).reduce((a, b) => a + b, 0);
  const total =
    Object.entries(qty).reduce((acc, [k, n]) => acc + n * priceOf(keyType(k), keyFare(k)), 0) +
    chosenSeats.reduce((acc, s) => acc + (seatFare[s.id] ? priceOf(s.ticketTypeId, seatFare[s.id]) : (s.precioCents ?? 0)), 0);
  // Tarifas elegidas con requisito: se recuerda qué hay que llevar a la puerta.
  const requirements = [
    ...new Map(
      [...chosenSeats.map((s) => [s.ticketTypeId, seatFare[s.id]] as const), ...Object.entries(qty).filter(([, n]) => n > 0).map(([k]) => [keyType(k), keyFare(k)] as const)]
        .map(([tt, fid]) => (fid && tt ? typeById.get(tt)?.fares?.find((f) => f.id === fid) : undefined))
        .filter((f): f is NonNullable<typeof f> => !!f?.requirement)
        .map((f) => [f.id, f]),
    ).values(),
  ];

  // Reglas del pedido (la API las vuelve a comprobar).
  const ruleError = useMemo(() => {
    if (count > ev.maxPerOrder) return `Máximo ${ev.maxPerOrder} entradas por pedido`;
    const perType = new Map<string, number>();
    Object.entries(qty).forEach(([k, n]) => n && perType.set(keyType(k), (perType.get(keyType(k)) ?? 0) + n));
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
  }, [count, ev.maxPerOrder, qty, selected, detail.seats, typeById]);

  /** Tarifa de cada entrada, en el formato de la API (las generales, por categoría). */
  const fares = () => [
    ...[...selected].filter((id) => seatFare[id]).map((seatId) => ({ seatId, fareId: seatFare[seatId] })),
    ...Object.entries(qty).flatMap(([k, n]) =>
      keyFare(k) ? Array.from({ length: n }, () => ({ ticketTypeId: keyType(k), fareId: keyFare(k) })) : [],
    ),
  ];

  const payable = coupon ? coupon.totalCents : total;

  /** Lo elegido, en el formato de la API (reserva y presupuesto con código). */
  const selection = () => {
    const quantities: Record<string, number> = {};
    for (const [k, n] of Object.entries(qty)) if (n > 0) quantities[keyType(k)] = (quantities[keyType(k)] ?? 0) + n;
    return {
      ...(selected.size ? { seatIds: [...selected] } : {}),
      ...(Object.keys(quantities).length ? { quantities } : {}),
    };
  };

  /** Pide el total con el código; devuelve el mensaje de error o null si se aplicó. */
  async function applyCoupon(code: string): Promise<string | null> {
    const r = await fetch(`${API_URL}/shop/${slug}/coupons/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: ev.id, code, ...selection(), fares: fares() }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (!r?.ok) {
      setCoupon(null);
      return body?.message ?? "No se pudo comprobar el código";
    }
    setCoupon({ code: body.code, discountCents: body.discountCents, totalCents: body.totalCents });
    return null;
  }

  // Si cambia la selección con un código aplicado, se recalcula (puede dejar de valer).
  const couponCode = coupon?.code;
  useEffect(() => {
    if (!couponCode) return;
    if (count === 0) {
      setCoupon(null);
      return;
    }
    void applyCoupon(couponCode).then((err) => err && setError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponCode, count, total]);

  // Más de 400 €: la factura simplificada no vale y los datos de facturación son obligatorios.
  const invoiceRequired = payable > 40_000;
  const sendBilling = wantsInvoice || invoiceRequired;
  const billingOk = !sendBilling || billingComplete(billing);

  // ¿Alguna plaza reservada pide datos de asistentes?
  const needsAttendees = !!heldSeats?.some((s) => fieldsFor(detail.attendeeFields, s.ticketTypeId).length > 0);

  const canBuy = billingOk && sales.open && count > 0 && emailOk && !!buyerName.trim() && !ruleError && !loading;

  function toggle(seatId: string, isAvailable: boolean) {
    if (!isAvailable || hold) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(seatId) ? next.delete(seatId) : next.add(seatId);
      return next;
    });
    setSeatFare(({ [seatId]: _drop, ...rest }) => rest);
  }

  /**
   * Paso 1 → 2: RESERVA lo elegido y arranca el contador (como Ticketmaster o Eventbrite).
   * Si algo ya no está, se avisa aquí, antes de pedir ningún dato.
   */
  async function reservar() {
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      const holdRes = await fetch(`${API_URL}/shop/${slug}/holds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: ev.id, sessionId: sessionId.current, ...selection() }),
      });
      if (!holdRes.ok) {
        const body = await holdRes.json().catch(() => null);
        if (hasGeneral) refresh();
        throw new Error(body?.message ?? "Alguna entrada ya no está disponible");
      }
      const h = await holdRes.json();
      // Tiempo restante según el SERVIDOR (el reloj del comprador puede ir mal).
      const remaining = new Date(h.expiresAt).getTime() - new Date(h.serverNow).getTime();
      setHold({ id: h.holdId, deadline: Date.now() + remaining });
      setHeldSeats(h.seats ?? []);
      setDetailsDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Paso 2 (con la reserva): si el evento pide datos de asistentes, se piden ahora; si no,
   * se crea el pedido y el cobro. Un error (p. ej. NIF inválido) NO suelta la reserva.
   */
  async function pagar() {
    if (!hold) return;
    if (!emailOk) {
      setError("Introduce un email válido: te enviaremos ahí las entradas");
      return;
    }
    setError(null);
    if (needsAttendees) {
      setDetailsDone(true);
      return;
    }
    setLoading(true);
    try {
      await startCheckout(hold);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Crea el pedido y el cobro. Si viene del formulario y la API rechaza algún dato, la
   * reserva se MANTIENE para que el comprador lo corrija (el error se lanza al llamador).
   */
  async function startCheckout(held: ActiveHold, attendees?: { seatId: string; values: Record<string, unknown> }[]) {
    const coRes = await fetch(`${API_URL}/shop/${slug}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        holdId: held.id,
        buyerEmail: email.trim(),
        buyerName: buyerName.trim() || undefined,
        attendees,
        fares: fares(),
        couponCode: coupon?.code,
        billing: sendBilling ? billing : undefined,
        method,
      }),
    });
    if (!coRes.ok) {
      const body = await coRes.json().catch(() => null);
      throw new Error(body?.message ?? "No se pudo iniciar el pago");
    }
    const co = await coRes.json();
    // Pasarela por redirección (Redsys: tarjeta o Bizum): el navegador va a pagar allí y
    // vuelve a la página de éxito, que confirma el pago firmado.
    if (co.redirect) {
      // Redsys/Bizum no se pueden mostrar dentro de un iframe: van a la ventana completa.
      submitRedirect(co.redirect.url, co.redirect.fields, embed);
      return;
    }
    // Pedido gratuito: ya está emitido, no hay pago.
    if (co.free) {
      router.push(`${base}/success?event=${ev.id}`);
      return;
    }
    setCheckout({
      amountCents: Number(co.amountCents),
      clientSecret: co.clientSecret,
      publishableKey: co.publishableKey,
    });
  }

  async function submitAttendees(attendees: { seatId: string; values: Record<string, unknown> }[]) {
    if (!hold) return;
    setLoading(true);
    setError(null);
    try {
      await startCheckout(hold, attendees);
    } catch (e) {
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
    setHeldSeats(null);
    setCheckout(null);
    setDetailsDone(false);
    setLoading(false);
    if (hasGeneral) refresh();
  }

  /** Se acabó el tiempo: fuera el pago; el servidor libera las plazas. */
  const onExpire = useCallback(() => {
    setHold(null);
    setHeldSeats(null);
    setCheckout(null);
    setDetailsDone(false);
    setExpired(true);
    if (hasGeneral) setTimeout(refresh, 25_000); // tras el barrido del servidor
  }, [hasGeneral, refresh]);

  const stripePromise = useMemo(() => (checkout ? loadStripe(checkout.publishableKey) : null), [checkout]);

  const accent = accentOf(detail.organizer);
  // Solo se fuerza el color si el promotor eligió uno; si no, cada tema usa su azul.
  const themeVars = (
    detail.organizer?.accentColor ? { "--accent": accent, "--accent-ink": inkFor(accent) } : {}
  ) as React.CSSProperties;
  const theme = themeOf(detail.organizer);
  const showMap = hasMap && sales.open;
  const fromCents = Math.min(...detail.ticketTypes.map((t) => t.precioCents ?? Infinity));

  // Paso de la caja de compra: ① entradas → ② tus datos. Con reserva activa manda el
  // contador (asistentes o pago).
  const canContinue = sales.open && count > 0 && !ruleError;

  // Móvil: barra fija con el total cuando la caja de compra no se ve.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Paso 2 (con la reserva ya hecha): datos del comprador, factura, código y forma de pago.
  const DETAILS = (
    <>
          <div className="panel-steps">
            <button className="btn-link" style={{ fontSize: 12 }} onClick={changeSelection} disabled={loading}>
              ← 1 · Entradas
            </button>
            <span>›</span>
            <span className="on">2 · Tus datos</span>
          </div>
          <label style={{ display: "block", fontSize: 14 }}>
            Tu nombre
            <input
              required
              autoComplete="name"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Nombre y apellidos"
              maxLength={120}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "block", fontSize: 14 }}>
            Email (recibirás aquí tus entradas)
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              style={{ ...inputStyle, borderColor: email && !emailOk ? "var(--danger)" : "var(--border)" }}
            />
          </label>
          {payable > 0 && (
            <BillingBox
              enabled={wantsInvoice}
              required={invoiceRequired}
              value={billing}
              onEnabled={setWantsInvoice}
              onChange={setBilling}
            />
          )}
          {detail.couponsAvailable && (
            <CouponBox applied={coupon} disabled={count === 0} onApply={applyCoupon} onRemove={() => setCoupon(null)} />
          )}
          {payable > 0 && methods.length > 1 && (
            <div style={{ display: "flex", gap: 8, fontSize: 14 }} role="radiogroup" aria-label="Forma de pago">
              {methods.map((m) => (
                <label
                  key={m}
                  style={{
                    flex: 1,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${method === m ? "var(--accent)" : "var(--border)"}`,
                    background: method === m ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <input type="radio" name="pay-method" checked={method === m} onChange={() => setMethod(m)} />
                  {m === "card" ? <CreditCard size={16} /> : <Smartphone size={16} />}
                  {m === "card" ? "Tarjeta" : "Bizum"}
                </label>
              ))}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          <TotalRow count={count} total={total} payable={payable} coupon={coupon} />
          <button className="btn-primary" onClick={pagar} disabled={!canBuy}>
            {loading
              ? "Procesando…"
              : needsAttendees
                ? "Continuar"
                : payable === 0
                  ? "Confirmar (gratis)"
                  : `Pagar ${euros(payable)}`}
          </button>
          {detail.privacy && <PrivacyNotice p={detail.privacy} />}
        </>
  );

  const purchase = (
    <div className="panel" ref={panelRef} id="comprar">
      {!sales.open ? (
        <>
          <h2>Entradas</h2>
          <div className={`notice ${ev.status === "CANCELLED" ? "error" : "warn"}`}>
            {sales.message}
            {sales.from && ` (a partir del ${formatDate(sales.from, ev.timezone)})`}
          </div>
        </>
      ) : expired ? (
        <>
          <h2>Se ha agotado el tiempo</h2>
          <p style={muted}>
            Tus entradas se han liberado y no se ha realizado ningún cobro. Puedes volver a intentarlo si siguen
            disponibles.
          </p>
          <button className="btn-primary" onClick={() => setExpired(false)}>
            Volver a intentarlo
          </button>
        </>
      ) : !hold ? (
        <>
          <div className="panel-steps">
            <span className="on">1 · Entradas</span>
            <span>›</span>
            <span>2 · Tus datos</span>
          </div>
          {hasMap && (
            <div style={{ display: "grid", gap: 6 }}>
              {mixed && <strong style={{ fontSize: 14 }}>Asientos numerados</strong>}
              <SelectedSeats
                detail={detail}
                selected={selected}
                seatFare={seatFare}
                priceOf={priceOf}
                onFare={(id, f) => setSeatFare((p) => ({ ...p, [id]: f }))}
                onRemove={(id) => toggle(id, true)}
              />
            </div>
          )}
          {hasGeneral && (
            <div style={{ display: "grid" }}>
              {mixed && <strong style={{ fontSize: 14, marginTop: 6 }}>Sin asiento</strong>}
              {generalTypes.map((t) => {
                // Con tarifas: una fila por tarifa («Pista · General», «Pista · Jubilado»…) que
                // comparten las plazas libres y el máximo por pedido de la categoría.
                const variants = [null, ...(t.fares ?? [])];
                const keys = variants.map((f) => (f ? `${t.id}|${f.id}` : t.id));
                const used = keys.reduce((a, k) => a + (qty[k] ?? 0), 0);
                return variants.map((f, i) => {
                  const k = keys[i];
                  const others = used - (qty[k] ?? 0);
                  const row: ShopTicketType = f
                    ? {
                        ...t,
                        name: `${t.name} · ${f.name}`,
                        description: f.requirement,
                        precioCents: f.precioCents,
                        regularCents: null,
                        minPerOrder: 1,
                        disponibles: Math.max(0, t.disponibles - others),
                        maxPerOrder: t.maxPerOrder == null ? null : Math.max(0, t.maxPerOrder - others),
                      }
                    : variants.length > 1
                      ? {
                          ...t,
                          name: `${t.name} · General`,
                          disponibles: Math.max(0, t.disponibles - others),
                          maxPerOrder: t.maxPerOrder == null ? null : Math.max(0, t.maxPerOrder - others),
                        }
                      : t;
                  return (
                    <QuantityRow
                      key={k}
                      t={row}
                      tz={ev.timezone}
                      value={qty[k] ?? 0}
                      disabled={false}
                      onChange={(n) => setQty((p) => ({ ...p, [k]: n }))}
                    />
                  );
                });
              })}
            </div>
          )}
          {ruleError && <div className="notice warn">{ruleError}</div>}
          {error && <div className="notice error">{error}</div>}
          {requirements.length > 0 && (
            <div className="notice warn" style={{ fontSize: 13 }}>
              Tarifas reducidas: se comprueban en la entrada.
              {requirements.map((f) => (
                <div key={f.id}>
                  <strong>{f.name}</strong>: {f.requirement}
                </div>
              ))}
            </div>
          )}
          <TotalRow count={count} total={total} payable={payable} coupon={coupon} />
          <button className="btn-primary" disabled={!canContinue || loading} onClick={reservar}>
            {loading
              ? "Reservando…"
              : count === 0
                ? hasMap && !hasGeneral
                  ? "Elige tus asientos"
                  : "Elige tus entradas"
                : "Continuar"}
          </button>
          {count > 0 && (
            <span style={{ ...muted, fontSize: 12, textAlign: "center" }}>
              Al continuar te las guardamos {detail.holdMinutes ?? 10} minutos mientras completas la compra.
            </span>
          )}
        </>
      ) : (
        <>
          <HoldTimer deadline={hold.deadline} onExpire={onExpire} onChange={changeSelection} busy={loading} />
          {!checkout && !(needsAttendees && detailsDone) && DETAILS}
          {heldSeats && !checkout && needsAttendees && detailsDone && (
            <AttendeesForm
              seats={heldSeats}
              fields={detail.attendeeFields}
              buyer={{ name: buyerName.trim(), email: email.trim() }}
              busy={loading}
              error={error}
              onSubmit={submitAttendees}
            />
          )}
          {checkout && stripePromise && (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: checkout.clientSecret,
                locale: "es",
                // Mismo aspecto que la tienda: tema del promotor y su color de marca. Stripe
                // pinta en su propio iframe: necesita colores reales, no variables CSS.
                appearance: stripeAppearance(theme, detail.organizer?.accentColor ? accent : null),
                fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" }],
              }}
            >
              <PaymentForm slug={slug} base={base} eventId={ev.id} total={checkout.amountCents} email={email.trim()} deadline={hold.deadline} />
            </Elements>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={`theme-root${embed ? " embed" : ""}`} data-theme={theme} style={themeVars}>
    <main className="page-wide">
      {embed && backToList && (
        <a className="back" href={`/embed/${slug}`}>
          <ArrowLeft size={16} /> Cartelera
        </a>
      )}
      {!embed && (
        <a className="back" href={`/${slug}`}>
          <ArrowLeft size={16} /> {detail.organizer ? `Más eventos de ${detail.organizer.name}` : "Todos los eventos"}
        </a>
      )}

      <header className="ev-hero">
        {ev.imageUrl && <div className="ev-hero-bg" style={{ backgroundImage: `url("${ev.imageUrl}")` }} />}
        {ev.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ev-poster" src={ev.imageUrl} alt={`Cartel de ${ev.name}`} />
        )}
        <div style={{ gridColumn: ev.imageUrl ? undefined : "1 / -1" }}>
          <div className="ev-kicker">
            {ev.category && <span>{ev.category}</span>}
            {sales.open && <span className={`live ${live ? "on" : ""}`}>{live ? "● disponibilidad en vivo" : "○ conectando…"}</span>}
          </div>
          <h1 className="ev-title">{ev.name}</h1>
          {ev.summary && <p className="ev-summary">{ev.summary}</p>}
          <div className="ev-facts">
            <span className="ev-fact">
              <Calendar size={18} />
              <span>
                {formatDate(ev.startsAt, ev.timezone, { long: true })}
                {ev.doorsAt && <small> · puertas {formatDate(ev.doorsAt, ev.timezone, { timeOnly: true })}</small>}
              </span>
            </span>
            {venue && (
              <span className="ev-fact">
                <MapPin size={18} />
                <span>
                  {venue.name}
                  {(venue.address || venue.city) && <small> · {[venue.address, venue.city].filter(Boolean).join(", ")}</small>}
                </span>
              </span>
            )}
            {Number.isFinite(fromCents) && sales.open && (
              <span className="ev-fact">
                <Ticket size={18} />
                <span>{fromCents === 0 ? "Gratis" : `Desde ${euros(fromCents)}`}</span>
              </span>
            )}
          </div>
          <div className="ev-actions">
            <ShareButton title={ev.name} />
            {ev.startsAt && (
              <button className="chip-btn" onClick={() => downloadIcs(ev, venue)}>
                <CalendarPlus size={15} /> Añadir al calendario
              </button>
            )}
          </div>
        </div>
      </header>

      {sessions.length > 1 && (
        // Varias funciones del mismo espectáculo: se elige la fecha (cada una, su propio aforo).
        <nav className="ev-sessions" aria-label="Elige función">
          <h2>Elige función</h2>
          <div className="ev-sessions-list">
            {sessions.map((x) => {
              const current = x.id === ev.id;
              const off = x.soldOut || x.closed;
              const label = (
                <>
                  <strong>{formatDate(x.startsAt, ev.timezone, { dayOnly: true })}</strong>
                  <span>{formatDate(x.startsAt, ev.timezone, { timeOnly: true })}</span>
                  {off && <small>{x.soldOut ? "Agotado" : "Venta cerrada"}</small>}
                </>
              );
              return current || hold ? (
                <span key={x.id} className={`ev-session${current ? " on" : ""}${off ? " off" : ""}`} aria-current={current ? "date" : undefined}>
                  {label}
                </span>
              ) : (
                <a key={x.id} className={`ev-session${off ? " off" : ""}`} href={`${base}/event/${x.id}${embed && backToList ? "?desde=cartelera" : ""}`}>
                  {label}
                </a>
              );
            })}
          </div>
          {hold && <small className="faint">Para cambiar de función, libera antes tus entradas.</small>}
        </nav>
      )}

      <div className={`ev-grid ${showMap ? "" : "no-map"}`}>
        {showMap && (
          <section className="ev-map section">
            <h2>Elige tus asientos</h2>
            <SeatMap
              detail={detail}
              selected={selected}
              unavailable={unavailable}
              sold={sold}
              locked={!!hold}
              onToggle={toggle}
            />
          </section>
        )}

        <aside className="ev-side" aria-label="Compra de entradas">
          {purchase}
        </aside>

        <div className="ev-info">
          {ev.description && (
            <section className="section">
              <h2>Información</h2>
              <p className="prose">{ev.description}</p>
            </section>
          )}

          <section className="cards">
            <div className="card">
              <h3>
                <Clock size={16} /> Cuándo
              </h3>
              <p>{formatDate(ev.startsAt, ev.timezone, { long: true })}</p>
              {ev.doorsAt && <p style={muted}>Apertura de puertas: {formatDate(ev.doorsAt, ev.timezone, { timeOnly: true })}</p>}
            </div>
            {venue && (
              <div className="card">
                <h3>
                  <MapPin size={16} /> Dónde
                </h3>
                <p>{venue.name}</p>
                <p style={muted}>{[venue.address, venue.postalCode, venue.city].filter(Boolean).join(", ")}</p>
                {venue.mapsUrl && (
                  <a href={venue.mapsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
                    Cómo llegar ↗
                  </a>
                )}
              </div>
            )}
            {ev.minAge != null && (
              <div className="card">
                <h3>
                  <ShieldCheck size={16} /> Acceso
                </h3>
                <p>Edad mínima: {ev.minAge} años</p>
              </div>
            )}
          </section>

          {(ev.refundPolicy || ev.contactEmail) && (
            <section className="card" style={{ display: "grid", gap: 10 }}>
              {ev.refundPolicy && (
                <div>
                  <h3>
                    <Undo2 size={16} /> Devoluciones
                  </h3>
                  <p style={{ ...muted, whiteSpace: "pre-wrap" }}>{ev.refundPolicy}</p>
                </div>
              )}
              {ev.contactEmail && (
                <div>
                  <h3>
                    <Mail size={16} /> Contacto
                  </h3>
                  <a href={`mailto:${ev.contactEmail}`}>{ev.contactEmail}</a>
                </div>
              )}
            </section>
          )}

          {detail.organizer && !embed && (
            <a href={`/${slug}`} className="card" style={{ display: "flex", alignItems: "center", gap: 12, color: "inherit", textDecoration: "none" }}>
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  flex: "none",
                  background: detail.organizer.logoUrl ? `center/cover url("${detail.organizer.logoUrl}") #fff` : accent,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  color: inkFor(accent),
                }}
              >
                {!detail.organizer.logoUrl && detail.organizer.name[0]?.toUpperCase()}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ ...muted, fontSize: 13 }}>Organiza</span>
                <br />
                <strong>{detail.organizer.name}</strong>
              </span>
              <span style={{ color: "var(--accent)", fontSize: 14 }}>Ver más eventos →</span>
            </a>
          )}
        </div>
      </div>

      {sales.open && !hold && !expired && !embed && (
        <div className={`mobile-bar ${panelVisible ? "hidden" : ""}`}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{count > 0 ? `${count} entrada(s)` : "Entradas"}</div>
            <strong style={{ fontSize: 18 }}>
              {count > 0 ? euros(payable) : Number.isFinite(fromCents) ? `Desde ${euros(fromCents)}` : "—"}
            </strong>
          </div>
          <button
            className="btn-primary"
            onClick={() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {count > 0 ? "Continuar" : "Comprar"}
          </button>
        </div>
      )}
    </main>
    </div>
  );
}

/** Formulario de pago de Stripe con los colores del tema de la tienda. */
function stripeAppearance(theme: "light" | "dark", accent: string | null) {
  const dark = theme === "dark";
  return {
    theme: dark ? ("night" as const) : ("stripe" as const),
    variables: {
      colorPrimary: accent ?? (dark ? "#5b9dff" : "#2563eb"),
      colorBackground: dark ? "#0f1115" : "#ffffff",
      colorText: dark ? "#e9edf2" : "#121826",
      colorTextSecondary: dark ? "#9aa3b2" : "#4b5563",
      borderRadius: "10px",
      fontFamily: "Inter, system-ui, sans-serif",
    },
  };
}

/** Total con el descuento aplicado (tachado el original). */
function TotalRow({
  count,
  total,
  payable,
  coupon,
}: {
  count: number;
  total: number;
  payable: number;
  coupon: AppliedCoupon | null;
}) {
  return (
    <div className="total-row">
      <span style={muted}>{count > 0 ? `Total · ${count} entrada${count === 1 ? "" : "s"}` : "Total"}</span>
      <span>
        {coupon && count > 0 && <s>{euros(total)}</s>}
        <strong style={count === 0 ? { color: "var(--faint)" } : undefined}>
          {count === 0 ? "0,00 €" : payable === 0 ? "Gratis" : euros(payable)}
        </strong>
      </span>
    </div>
  );
}

/** Clave de cantidades: "categoría" o "categoría|tarifa". */
const keyType = (k: string) => k.split("|")[0];
const keyFare = (k: string) => k.split("|")[1] ?? null;

/** Numerado: los asientos elegidos en el plano, en la caja de compra. */
function SelectedSeats({
  detail,
  selected,
  seatFare,
  priceOf,
  onFare,
  onRemove,
}: {
  detail: EventDetail;
  selected: Set<string>;
  seatFare: Record<string, string>;
  priceOf: (typeId: string | null, fareId?: string | null) => number;
  onFare: (seatId: string, fareId: string) => void;
  onRemove: (id: string) => void;
}) {
  const seats = detail.seats.filter((s) => selected.has(s.id));
  if (!seats.length) return <p style={{ ...muted, margin: 0 }}>Toca los asientos libres en el plano para elegirlos.</p>;
  const faresOf = (typeId: string | null) => detail.ticketTypes.find((t) => t.id === typeId)?.fares ?? [];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {seats.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <strong style={{ minWidth: 44 }}>
            {s.fila}
            {s.numero}
          </strong>
          {faresOf(s.ticketTypeId).length > 0 ? (
            // Tarifa de esta butaca: general o reducida (jubilado, estudiante…).
            <select
              className="fare-select"
              aria-label={`Tarifa de ${s.fila}${s.numero}`}
              value={seatFare[s.id] ?? ""}
              onChange={(e) => onFare(s.id, e.target.value)}
            >
              <option value="">{s.categoria} · General</option>
              {faresOf(s.ticketTypeId).map((f) => (
                <option key={f.id} value={f.id}>
                  {s.categoria} · {f.name}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ ...muted, flex: 1 }}>{s.categoria}</span>
          )}
          <span>{euros(seatFare[s.id] ? priceOf(s.ticketTypeId, seatFare[s.id]) : s.precioCents)}</span>
          <button className="btn-link" aria-label={`Quitar ${s.fila}${s.numero}`} onClick={() => onRemove(s.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Compartir: menú nativo del móvil o, si no hay, copiar el enlace. */
function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button className="chip-btn" onClick={share}>
      <Share2 size={15} /> {copied ? "Enlace copiado" : "Compartir"}
    </button>
  );
}

/** Descarga un .ics para añadir el evento al calendario (Google, Apple, Outlook). */
function downloadIcs(ev: EventDetail["event"], venue: EventDetail["venue"]) {
  if (!ev.startsAt) return;
  const stamp = (d: string | Date) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = ev.endsAt ?? new Date(new Date(ev.startsAt).getTime() + 3 * 3_600_000).toISOString();
  const esc = (t: string) => t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Entradas//ES",
    "BEGIN:VEVENT",
    `UID:${ev.id}@entradas`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.name)}`,
    ...(venue ? [`LOCATION:${esc([venue.name, venue.address, venue.city].filter(Boolean).join(", "))}`] : []),
    `URL:${window.location.href}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `${ev.name.replace(/[^\p{L}\p{N}]+/gu, "-")}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
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
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        columnGap: 14,
        rowGap: 4,
        padding: "12px 14px",
        borderRadius: 10,
        background: urgent ? "var(--warn-bg)" : "var(--info-bg)",
        border: `1px solid ${urgent ? "var(--warn)" : "var(--info-border)"}`,
      }}
    >
      <span style={{ fontSize: 26, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: urgent ? "var(--warn)" : "var(--text)" }}>
        {mmss}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.35, color: urgent ? "var(--warn-text)" : "var(--info-text)" }}>
        {urgent ? "¡Date prisa! Al acabarse el tiempo se liberan." : "Entradas reservadas para ti mientras completas la compra."}
      </span>
      <button
        onClick={onChange}
        disabled={busy}
        style={{
          gridColumn: "1 / -1",
          justifySelf: "start",
          background: "none",
          border: "none",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: 13,
          padding: 0,
        }}
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
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
        opacity: blocked && !disabled ? 0.6 : 1,
      }}
    >
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
        <span style={{ fontSize: 12, color: soldOut ? "var(--danger)" : !t.salesOpen || t.disponibles <= 10 ? "var(--warn)" : "var(--faint)" }}>
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
        border: `1px solid ${disabled ? "var(--border)" : "var(--accent)"}`,
        background: disabled ? "transparent" : "var(--surface-2)",
        color: disabled ? "var(--disabled)" : "var(--text)",
        fontSize: 18,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Información básica de protección de datos (art. 13 RGPD) junto al botón de compra:
 * quién es el responsable, para qué, cuánto tiempo y dónde ejercer los derechos.
 */
function PrivacyNotice({ p }: { p: NonNullable<EventDetail["privacy"]> }) {
  const link = { color: "var(--muted)", textDecoration: "underline" } as const;
  return (
    <p style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.5, margin: "12px 0 0" }}>
      {p.termsUrl && (
        <>
          Al comprar aceptas las{" "}
          <a href={p.termsUrl} target="_blank" rel="noreferrer" style={link}>
            condiciones de compra
          </a>
          .{" "}
        </>
      )}
      Tus datos los trata <strong>{p.controller}</strong> para gestionar tu compra, enviarte las entradas y controlar el
      acceso al evento. Los datos de los asistentes se borran {p.retentionDays} días después del evento; los de facturación
      se conservan lo que exige la ley.
      {p.contactEmail && (
        <>
          {" "}
          Puedes acceder a tus datos, corregirlos o pedir que se borren escribiendo a{" "}
          <a href={`mailto:${p.contactEmail}`} style={link}>
            {p.contactEmail}
          </a>
          .
        </>
      )}
      {p.privacyUrl && (
        <>
          {" "}
          <a href={p.privacyUrl} target="_blank" rel="noreferrer" style={link}>
            Política de privacidad
          </a>
          .
        </>
      )}
    </p>
  );
}

/**
 * Envía el navegador a la pasarela con un formulario POST (así lo exige Redsys). Desde un
 * módulo incrustado se abre en la ventana completa (`_top`): el banco no deja pagar dentro
 * de un iframe; al terminar, el comprador vuelve a la tienda.
 */
function submitRedirect(url: string, fields: Record<string, string>, top = false) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  if (top) form.target = "_top";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function PaymentForm({
  slug,
  base,
  eventId,
  total,
  email,
  deadline,
}: {
  slug: string;
  base: string;
  eventId: string;
  total: number;
  email: string;
  deadline: number;
}) {
  const router = useRouter();
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
    // Sin redirección salvo que el método la exija (tarjeta: no). Así, incrustada en la web
    // del promotor, la compra termina DENTRO del módulo. Si hay redirección (p. ej. Klarna),
    // Stripe navega la ventana completa: vuelve a la página de éxito normal de la tienda.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${slug}/success?event=${eventId}`,
      },
      redirect: "if_required",
    });
    if (error) {
      setError(error.message ?? "El pago no se pudo completar");
      setPaying(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      router.push(`${base}/success?event=${eventId}`);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Pago · {euros(total)}</h2>
      <p style={{ fontSize: 13, color: "var(--faint)" }}>Las entradas se enviarán a {email}</p>
      <PaymentElement />
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={pay} disabled={!stripe || paying}>
        {paying ? "Pagando…" : "Pagar"}
      </button>
    </div>
  );
}
