"use client";

import { euros, type EventDetail } from "../../../../lib/api";

/** Colores de las categorías numeradas (la primera, el color de marca). */
const PALETTE = ["var(--accent)", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0891b2", "#65a30d", "#dc2626"];

/**
 * Plano de asientos para elegir butaca. Compacto (cada butaca muestra solo su número; el
 * detalle, al pasar por encima), con la letra de cada fila, un color por categoría y
 * leyenda. Nunca se sale de su columna: si no cabe, se desplaza dentro de su recuadro.
 * posX = columna, posY = fila (0 = junto al escenario).
 */
export default function SeatMap({
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
  const reservedTypes = detail.ticketTypes.filter((t) => (t.seating ?? "RESERVED") === "RESERVED");
  const colorOf = new Map(reservedTypes.map((t, i) => [t.id, PALETTE[i % PALETTE.length]]));
  const placed = detail.seats.filter((s) => s.posX != null && s.posY != null);
  const unplaced = detail.seats.filter((s) => s.posX == null || s.posY == null);
  const cols = placed.length ? Math.max(...placed.map((s) => s.posX!)) + 1 : 1;
  const rows = placed.length ? Math.max(...placed.map((s) => s.posY!)) + 1 : 1;

  // Letra de cada fila del plano (la más repetida entre sus butacas).
  const rowLabel = new Map<number, string>();
  for (let y = 0; y < rows; y++) {
    const counts = new Map<string, number>();
    for (const s of placed) if (s.posY === y) counts.set(s.fila, (counts.get(s.fila) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best) rowLabel.set(y, best[0]);
  }

  function seat(s: (typeof detail.seats)[number], grid: boolean) {
    const isSel = selected.has(s.id);
    const isSold = sold.has(s.id);
    const isAvailable = !unavailable.has(s.id) && s.precioCents != null;
    const color = (s.ticketTypeId && colorOf.get(s.ticketTypeId)) || "var(--muted)";
    const state = isSel ? "tu selección" : !isAvailable ? (isSold ? "vendido" : "ocupado") : "libre";
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => onToggle(s.id, isAvailable)}
        disabled={!isAvailable || locked}
        aria-pressed={isSel}
        aria-label={`Fila ${s.fila}, asiento ${s.numero}, ${s.categoria ?? ""}, ${euros(s.precioCents)}, ${state}`}
        title={`Fila ${s.fila} · asiento ${s.numero}\n${s.categoria ?? ""} · ${euros(s.precioCents)}\n${state}`}
        style={{
          gridColumnStart: grid ? s.posX! + 2 : undefined,
          gridRowStart: grid ? s.posY! + 1 : undefined,
          width: grid ? "100%" : 36,
          aspectRatio: "1",
          padding: 0,
          borderRadius: "8px 8px 4px 4px",
          border: isAvailable ? `1.5px solid ${color}` : "1.5px solid transparent",
          background: isSel
            ? color
            : !isAvailable
              ? isSold
                ? "var(--seat-sold)"
                : "var(--seat-held)"
              : `color-mix(in srgb, ${color} 14%, var(--surface))`,
          color: isSel ? "#fff" : isAvailable ? "var(--text)" : "var(--seat-off-text)",
          fontSize: 10,
          fontWeight: isSel ? 700 : 500,
          overflow: "hidden",
          cursor: isAvailable && !locked ? "pointer" : "not-allowed",
          transition: "background 0.2s, border-color 0.2s",
        }}
      >
        {/* Si la butaca no es de la fila de su línea (planos mezclados), se muestra la fila. */}
        {grid && s.posY != null && rowLabel.get(s.posY) !== s.fila ? `${s.fila}${s.numero}` : s.numero}
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Leyenda: categorías (color y precio) y estados. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 13 }}>
        {reservedTypes.map((t) => (
          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Swatch color={colorOf.get(t.id)!} />
            <strong>{t.name}</strong> {euros(t.precioCents)}
            {t.regularCents != null && <span style={{ color: "var(--muted)" }}>(anticipada)</span>}
            {!t.salesOpen && <span style={{ color: "var(--warn)" }}>· {t.salesMessage}</span>}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: "var(--muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Swatch color="var(--accent)" filled /> Tu selección
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Swatch color="var(--seat-held)" filled /> Ocupado
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Swatch color="var(--seat-sold)" filled /> Vendido
        </span>
      </div>

      {placed.length > 0 && (
        // Si el plano no cabe, se desplaza dentro de este recuadro (nunca ensancha la página).
        <div style={{ overflowX: "auto", maxWidth: "100%", paddingBottom: 6 }}>
          {/* Las butacas encogen hasta 22 px para caber; por debajo, el recuadro se desplaza. */}
          <div style={{ width: "100%", minWidth: 20 + cols * 27 }}>
            <div
              style={{
                textAlign: "center",
                padding: "6px 0",
                margin: "0 auto 14px",
                borderRadius: 6,
                background: "linear-gradient(var(--stage-from), var(--stage-to))",
                color: "var(--stage-text)",
                letterSpacing: 4,
                fontSize: 11,
                maxWidth: "70%",
              }}
            >
              ESCENARIO
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `20px repeat(${cols}, minmax(22px, 40px))`,
                gridTemplateRows: `repeat(${rows}, auto)`,
                gap: 5,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {[...rowLabel].map(([y, label]) => (
                <span
                  key={`r${y}`}
                  style={{ gridColumnStart: 1, gridRowStart: y + 1, fontSize: 11, fontWeight: 600, color: "var(--faint)", textAlign: "center" }}
                >
                  {label}
                </span>
              ))}
              {placed.map((s) => seat(s, true))}
            </div>
          </div>
        </div>
      )}

      {unplaced.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 8px" }}>Sin ubicar en el plano:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{unplaced.map((s) => seat(s, false))}</div>
        </div>
      )}
    </div>
  );
}

function Swatch({ color, filled }: { color: string; filled?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "4px 4px 2px 2px",
        flex: "none",
        border: `1.5px solid ${filled ? "transparent" : color}`,
        background: filled ? color : `color-mix(in srgb, ${color} 14%, var(--surface))`,
      }}
    />
  );
}
