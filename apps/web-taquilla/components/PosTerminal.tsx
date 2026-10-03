"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { euros, getSeats, type PosSeat, type PosSeatmap, sell, type SaleResult } from "../lib/api";

export default function PosTerminal({
  token,
  eventId,
  eventName,
  onBack,
}: {
  token: string;
  eventId: string;
  eventName: string;
  onBack: () => void;
}) {
  const [map, setMap] = useState<PosSeatmap | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<SaleResult | null>(null);

  async function reload() {
    setError(null);
    try {
      setMap(await getSeats(token, eventId));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    reload();
  }, [eventId]);

  const seats = map?.seats ?? [];
  const general = map?.event.seatingMode === "GENERAL";
  const placed = seats.filter((s) => s.posX != null && s.posY != null);
  const cols = placed.length ? Math.max(...placed.map((s) => s.posX!)) + 1 : 1;
  const rows = placed.length ? Math.max(...placed.map((s) => s.posY!)) + 1 : 1;
  const count = general ? Object.values(qty).reduce((a, b) => a + b, 0) : selected.size;
  const total = general
    ? (map?.ticketTypes ?? []).reduce((a, t) => a + (qty[t.id] ?? 0) * (t.precioCents ?? 0), 0)
    : seats.filter((s) => selected.has(s.id)).reduce((a, s) => a + (s.precioCents ?? 0), 0);

  function toggle(s: PosSeat) {
    if (!s.disponible) return;
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(s.id) ? n.delete(s.id) : n.add(s.id);
      return n;
    });
  }

  async function cobrar() {
    setBusy(true);
    setError(null);
    try {
      const res = await sell(
        token,
        eventId,
        general
          ? { quantities: Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0)) }
          : { seatIds: [...selected] },
        method,
        email,
      );
      setSale(res);
      setSelected(new Set());
      setQty({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function nuevaVenta() {
    setSale(null);
    setEmail("");
    await reload();
  }

  // Pantalla de venta completada (con impresión).
  if (sale) {
    return (
      <div>
        <style>{`@media print { body * { visibility: hidden; } #print-area, #print-area * { visibility: visible; } #print-area { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>
        <div className="no-print" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>✓ Venta completada</h2>
          <p style={{ color: "#9aa3b2" }}>
            {sale.tickets.length} entrada(s) · {euros(Number(sale.amountCents))} ·{" "}
            {sale.method === "cash" ? "efectivo" : `tarjeta (${sale.providerRef})`}
          </p>
          <button style={btnPrimary} onClick={() => window.print()}>
            🖨 Imprimir
          </button>{" "}
          <button style={btnGhost} onClick={nuevaVenta}>
            Nueva venta
          </button>
        </div>

        <div id="print-area" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {sale.tickets.map((t) => (
            <div key={t.ticketId} style={ticketCard}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#111" }}>{eventName}</div>
              <div style={{ fontSize: 14, color: "#333", margin: "4px 0 10px" }}>
                {general ? t.seat : `Asiento ${t.seat}`}
              </div>
              <QRCodeSVG value={t.qr} size={150} />
              <div style={{ fontSize: 9, color: "#888", marginTop: 8 }}>{t.ticketId}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Terminal de venta.
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button style={linkBtn} onClick={onBack}>
          ← eventos
        </button>
        <h2 style={{ margin: 0 }}>{eventName}</h2>
        <span />
      </div>

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

      {general && (
        <div style={{ display: "grid", gap: 10, margin: "16px 0" }}>
          {map!.ticketTypes.map((t) => {
            const n = qty[t.id] ?? 0;
            const set = (v: number) => setQty((p) => ({ ...p, [t.id]: Math.max(0, Math.min(t.disponibles, v)) }));
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "#171a21", borderRadius: 10, border: "1px solid #2b313c" }}>
                <div style={{ flex: 1 }}>
                  <strong>{t.name}</strong> · {euros(t.precioCents)}
                  <div style={{ fontSize: 12, color: t.disponibles ? "#7a8190" : "#ff6b6b" }}>
                    {t.disponibles ? `${t.disponibles} disponibles` : "Agotadas"}
                  </div>
                </div>
                <button style={stepBtn} onClick={() => set(n - 1)} disabled={n === 0}>−</button>
                <span style={{ minWidth: 28, textAlign: "center", fontSize: 20 }}>{n}</span>
                <button style={stepBtn} onClick={() => set(n + 1)} disabled={n >= t.disponibles}>+</button>
              </div>
            );
          })}
        </div>
      )}

      {!general && (
      <div style={{ textAlign: "center", padding: "6px 0", margin: "16px 0", borderRadius: 6, background: "linear-gradient(#23303f,#161d27)", color: "#9fb4cc", letterSpacing: 4, fontSize: 12, maxWidth: cols * 64 }}>
        ESCENARIO
      </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(56px, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)`, gap: 10, justifyContent: "center" }}>
        {placed.map((s) => {
          const sel = selected.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggle(s)}
              disabled={!s.disponible}
              style={{
                gridColumnStart: s.posX! + 1,
                gridRowStart: s.posY! + 1,
                padding: "10px 6px",
                borderRadius: 8,
                border: sel ? "2px solid #5b9dff" : "1px solid #2b313c",
                background: !s.disponible ? "#2a2030" : sel ? "#1d2b45" : "#171a21",
                color: !s.disponible ? "#8a7d72" : "#e9edf2",
                cursor: s.disponible ? "pointer" : "not-allowed",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {s.fila}
                {s.numero}
              </div>
              <div style={{ opacity: 0.7 }}>{s.categoria}</div>
              <div>{euros(s.precioCents)}</div>
              {!s.disponible && <div style={{ fontSize: 11 }}>vendido</div>}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: "#13161c", borderRadius: 10, border: "1px solid #1f2530" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setMethod("cash")} style={methodBtn(method === "cash")}>
            💶 Efectivo
          </button>
          <button onClick={() => setMethod("card")} style={methodBtn(method === "card")}>
            💳 Tarjeta (datáfono)
          </button>
        </div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email del comprador (opcional, para enviar la entrada)"
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #2b313c", background: "#0f1115", color: "#e9edf2", marginBottom: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 18 }}>Total: {euros(total)}</strong>
          <button onClick={cobrar} disabled={count === 0 || busy} style={{ ...btnPrimary, opacity: count === 0 ? 0.5 : 1 }}>
            {busy ? "Cobrando…" : total === 0 && count > 0 ? `Emitir (${count})` : `Cobrar (${count})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: "12px 22px", borderRadius: 8, border: "none", background: "#3ecf8e", color: "#08130d", fontWeight: 700, fontSize: 15, cursor: "pointer" };
const btnGhost: React.CSSProperties = { padding: "12px 18px", borderRadius: 8, border: "1px solid #2b313c", background: "#171a21", color: "#e9edf2", cursor: "pointer" };
const stepBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 8, border: "1px solid #2b313c", background: "#1d2b45", color: "#e9edf2", fontSize: 20, cursor: "pointer" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#5b9dff", cursor: "pointer", fontSize: 14, padding: 0 };
const methodBtn = (active: boolean): React.CSSProperties => ({ flex: 1, padding: 12, borderRadius: 8, border: active ? "2px solid #5b9dff" : "1px solid #2b313c", background: active ? "#1d2b45" : "#171a21", color: "#e9edf2", cursor: "pointer", fontSize: 14, fontWeight: 600 });
const ticketCard: React.CSSProperties = { background: "#fff", borderRadius: 10, padding: 18, width: 200, textAlign: "center", border: "1px solid #ddd" };
