"use client";

import { useEffect, useRef, useState } from "react";
import {
  type EditorSeat,
  euros,
  getSeatmap,
  type MapFeature,
  saveSeatmap,
  type Seatmap,
} from "../lib/api";

/** Hueco o elemento con nombre en el editor (id temporal: se guardan todos de una vez). */
type EditorFeature = MapFeature & { id: string };

/** Elementos con nombre más habituales (además de texto libre). */
const FEATURE_PRESETS = ["Escalera", "Columna", "Barra", "Salida", "Control", "Aseos"];

const CELL = 72; // px por celda de la rejilla
const PALETTE = ["#5b9dff", "#3ecf8e", "#e0a23c", "#c678dd", "#ef6f6f"];

interface DragState {
  /** Butaca o elemento (los elementos llevan id «f:…»). */
  seatId: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  rectLeft: number;
  rectTop: number;
}

export default function SeatmapEditor({ token, eventId }: { token: string; eventId: string }) {
  const [map, setMap] = useState<Seatmap | null>(null);
  const [seats, setSeats] = useState<EditorSeat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [features, setFeatures] = useState<EditorFeature[]>([]);
  const [featureLabel, setFeatureLabel] = useState(FEATURE_PRESETS[0]);
  const [newFila, setNewFila] = useState("A");
  const [newNumero, setNewNumero] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const tempSeq = useRef(0);

  function load() {
    return getSeatmap(token, eventId).then((m) => {
      setMap(m);
      setSeats(m.seats);
      setFeatures((m.features ?? []).map((f, i) => ({ ...f, id: `f:${i}` })));
      setDeleted([]);
      setSelected(null);
      setDirty(false);
    });
  }

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  if (!map) return error ? <p style={{ color: "#ff6b6b" }}>Error: {error}</p> : <p>Cargando plano…</p>;

  const colorOf = (ticketTypeId: string | null) => {
    if (!ticketTypeId) return "#3a4150";
    const idx = map.ticketTypes.findIndex((t) => t.id === ticketTypeId);
    return PALETTE[idx % PALETTE.length] ?? "#3a4150";
  };

  const placed = seats.filter((s) => s.posX != null && s.posY != null);
  const unplaced = seats.filter((s) => s.posX == null || s.posY == null);
  const xs = [...placed.map((s) => s.posX!), ...features.map((f) => f.posX)];
  const ys = [...placed.map((s) => s.posY!), ...features.map((f) => f.posY)];
  const cols = Math.max(6, xs.length ? Math.max(...xs) + 2 : 0);
  const rows = Math.max(4, ys.length ? Math.max(...ys) + 2 : 0);

  function patchFeature(id: string, patch: Partial<EditorFeature>) {
    setFeatures((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  function patchSeat(seatId: string, patch: Partial<EditorSeat>) {
    setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  function onPointerDown(e: React.PointerEvent, s: { id: string; posX: number | null; posY: number | null }) {
    const canvas = canvasRef.current;
    if (!canvas || s.posX == null || s.posY == null) return;
    const rect = canvas.getBoundingClientRect();
    const seatPxX = s.posX * CELL;
    const seatPxY = s.posY * CELL;
    setSelected(s.id);
    setDrag({
      seatId: s.id,
      x: seatPxX,
      y: seatPxY,
      offsetX: e.clientX - rect.left - seatPxX,
      offsetY: e.clientY - rect.top - seatPxY,
      rectLeft: rect.left,
      rectTop: rect.top,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    setDrag({
      ...drag,
      x: e.clientX - drag.rectLeft - drag.offsetX,
      y: e.clientY - drag.rectTop - drag.offsetY,
    });
  }

  function onPointerUp() {
    if (!drag) return;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const col = clamp(Math.round(drag.x / CELL), cols - 1);
    const row = clamp(Math.round(drag.y / CELL), rows - 1);
    // Si la celda destino está ocupada (butaca o elemento), intercambian posiciones.
    const items = [...seats, ...features];
    const moving = items.find((s) => s.id === drag.seatId)!;
    const occupant = items.find((s) => s.id !== drag.seatId && s.posX === col && s.posY === row);
    const move = (id: string, posX: number | null, posY: number | null) =>
      id.startsWith("f:") ? patchFeature(id, { posX: posX ?? 0, posY: posY ?? 0 }) : patchSeat(id, { posX, posY });
    if (occupant) move(occupant.id, moving.posX, moving.posY);
    move(drag.seatId, col, row);
    setDrag(null);
  }

  // Primera celda libre (orden por filas); la rejilla siempre deja una fila/columna
  // de margen, así que siempre hay hueco.
  function firstFreeCell(): { x: number; y: number } {
    const taken = new Set([...placed, ...features].map((p) => `${p.posX},${p.posY}`));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
    return { x: 0, y: rows };
  }

  function placeUnplaced(s: EditorSeat) {
    const { x, y } = firstFreeCell();
    patchSeat(s.id, { posX: x, posY: y });
    setSelected(s.id);
  }

  const fila = newFila.trim().toUpperCase();
  const nextNumero =
    Math.max(0, ...seats.filter((s) => s.fila.toUpperCase() === fila).map((s) => s.numero)) + 1;
  const numero = newNumero === "" ? nextNumero : Number(newNumero);
  const duplicate = seats.some((s) => s.fila.toUpperCase() === fila && s.numero === numero);
  const canAdd = !!fila && Number.isInteger(numero) && numero >= 1 && !duplicate;

  function addSeat() {
    if (!canAdd) return;
    const { x, y } = firstFreeCell();
    const id = `new:${++tempSeq.current}`;
    // Hereda la categoría del asiento seleccionado: añadir varios seguidos es rápido.
    const ticketTypeId = seats.find((s) => s.id === selected)?.ticketTypeId ?? null;
    setSeats((prev) => [
      ...prev,
      { id, fila, numero, posX: x, posY: y, zoneId: "", ticketTypeId, isNew: true },
    ]);
    setSelected(id);
    setNewNumero("");
    setDirty(true);
  }

  function addFeature(kind: "gap" | "label") {
    const label = kind === "label" ? featureLabel.trim() : null;
    if (kind === "label" && !label) return;
    const { x, y } = firstFreeCell();
    const id = `f:new${++tempSeq.current}`;
    setFeatures((prev) => [...prev, { id, kind, label, posX: x, posY: y }]);
    setSelected(id);
    setDirty(true);
  }

  function removeSelected() {
    if (selected?.startsWith("f:")) {
      setFeatures((prev) => prev.filter((f) => f.id !== selected));
      setSelected(null);
      setDirty(true);
      return;
    }
    const s = seats.find((x) => x.id === selected);
    if (!s) return;
    setSeats((prev) => prev.filter((x) => x.id !== s.id));
    if (!s.isNew) setDeleted((prev) => [...prev, s.id]);
    setSelected(null);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await saveSeatmap(token, eventId, {
        seats: seats
          .filter((s) => !s.isNew)
          .map((s) => ({ seatId: s.id, posX: s.posX, posY: s.posY, ticketTypeId: s.ticketTypeId })),
        created: seats
          .filter((s) => s.isNew)
          .map((s) => ({
            fila: s.fila,
            numero: s.numero,
            posX: s.posX,
            posY: s.posY,
            ticketTypeId: s.ticketTypeId,
          })),
        deleted,
        features: features.map(({ kind, label, posX, posY }) => ({ kind, label, posX, posY })),
      });
      // Recarga para obtener los ids reales de los asientos creados.
      await load();
      const extra = [
        res.created && `${res.created} creados`,
        res.deleted && `${res.deleted} eliminados`,
      ].filter(Boolean);
      setMsg(`Guardado${extra.length ? ` (${extra.join(", ")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const sel = seats.find((s) => s.id === selected) ?? null;
  const selFeature = features.find((f) => f.id === selected) ?? null;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#9aa3b2", marginTop: 0 }}>
        Arrastra los asientos para colocarlos. Selecciona uno y pulsa una categoría para asignarla. Usa{" "}
        <strong>huecos</strong> para pasillos y separaciones, y <strong>elementos</strong> (escalera, salida…) para
        que el comprador se oriente. Los cambios no se aplican hasta pulsar «Guardar plano».
      </p>

      {/* Paleta de categorías */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        {map.ticketTypes.map((t) => (
          <button
            key={t.id}
            disabled={!sel}
            onClick={() => sel && patchSeat(sel.id, { ticketTypeId: t.id })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #2b313c",
              background: "#171a21",
              color: "#e9edf2",
              cursor: sel ? "pointer" : "not-allowed",
              opacity: sel ? 1 : 0.5,
              fontSize: 13,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 3, background: colorOf(t.id) }} />
            {t.name} · {euros(t.precioCents)}
          </button>
        ))}
        <button
          disabled={!sel}
          onClick={() => sel && patchSeat(sel.id, { ticketTypeId: null })}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #2b313c",
            background: "#171a21",
            color: "#9aa3b2",
            cursor: sel ? "pointer" : "not-allowed",
            opacity: sel ? 1 : 0.5,
            fontSize: 13,
          }}
        >
          sin categoría
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#7a8190" }}>
          {sel
            ? `Seleccionado: ${sel.fila}${sel.numero}`
            : selFeature
              ? `Seleccionado: ${selFeature.kind === "gap" ? "hueco" : selFeature.label}`
              : "Nada seleccionado"}
        </span>
      </div>

      {/* Alta / baja de asientos */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <label style={{ fontSize: 13, color: "#9aa3b2" }}>
          Fila{" "}
          <input
            value={newFila}
            onChange={(e) => setNewFila(e.target.value)}
            maxLength={10}
            style={{ ...field, width: 48 }}
          />
        </label>
        <label style={{ fontSize: 13, color: "#9aa3b2" }}>
          Nº{" "}
          <input
            value={newNumero}
            onChange={(e) => setNewNumero(e.target.value.replace(/\D/g, ""))}
            placeholder={String(nextNumero)}
            inputMode="numeric"
            style={{ ...field, width: 56 }}
          />
        </label>
        <button onClick={addSeat} disabled={!canAdd} style={{ ...toolBtn, opacity: canAdd ? 1 : 0.5 }}>
          + Añadir asiento
        </button>
        {duplicate && <span style={{ fontSize: 12, color: "#e0a23c" }}>{fila}{numero} ya existe</span>}
        <button
          onClick={removeSelected}
          disabled={!sel && !selFeature}
          style={{ ...toolBtn, color: "#ff8a8a", opacity: sel || selFeature ? 1 : 0.5, marginLeft: "auto" }}
        >
          Eliminar {sel ? `${sel.fila}${sel.numero}` : selFeature ? (selFeature.label ?? "hueco") : "seleccionado"}
        </button>
      </div>

      {/* Huecos y elementos del plano */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <button onClick={() => addFeature("gap")} style={toolBtn} title="Celda vacía: pasillos y separaciones">
          + Hueco (pasillo)
        </button>
        <span style={{ width: 8 }} />
        <input
          list="feature-presets"
          value={featureLabel}
          onChange={(e) => setFeatureLabel(e.target.value.slice(0, 24))}
          style={{ ...field, width: 120 }}
          aria-label="Nombre del elemento"
        />
        <datalist id="feature-presets">
          {FEATURE_PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button onClick={() => addFeature("label")} disabled={!featureLabel.trim()} style={toolBtn}>
          + Elemento
        </button>
        {selFeature?.kind === "label" && (
          <label style={{ fontSize: 13, color: "#9aa3b2", marginLeft: "auto" }}>
            Nombre{" "}
            <input
              value={selFeature.label ?? ""}
              onChange={(e) => patchFeature(selFeature.id, { label: e.target.value.slice(0, 24) })}
              style={{ ...field, width: 120 }}
            />
          </label>
        )}
      </div>

      {/* Escenario */}
      <div
        style={{
          textAlign: "center",
          padding: "6px 0",
          borderRadius: 6,
          background: "linear-gradient(#23303f,#161d27)",
          color: "#9fb4cc",
          letterSpacing: 4,
          fontSize: 12,
          maxWidth: cols * CELL,
        }}
      >
        ESCENARIO
      </div>

      {/* Lienzo */}
      <div
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "relative",
          width: cols * CELL,
          height: rows * CELL,
          margin: "12px 0",
          borderRadius: 8,
          backgroundImage:
            "linear-gradient(#1b202a 1px, transparent 1px), linear-gradient(90deg, #1b202a 1px, transparent 1px)",
          backgroundSize: `${CELL}px ${CELL}px`,
          border: "1px solid #1b202a",
          touchAction: "none",
        }}
      >
        {features.map((f) => {
          const isDragging = drag?.seatId === f.id;
          const isSel = selected === f.id;
          return (
            <button
              key={f.id}
              onPointerDown={(e) => onPointerDown(e, f)}
              title={f.kind === "gap" ? "Hueco (pasillo)" : f.label ?? ""}
              style={{
                position: "absolute",
                left: isDragging ? drag!.x : f.posX * CELL,
                top: isDragging ? drag!.y : f.posY * CELL,
                width: CELL - 10,
                height: CELL - 10,
                margin: 5,
                borderRadius: 8,
                border: isSel ? "2px solid #fff" : `1px dashed ${f.kind === "gap" ? "#3a4150" : "#7a8190"}`,
                background: f.kind === "gap" ? "transparent" : "#2b313c",
                color: f.kind === "gap" ? "#5d6575" : "#c9d0da",
                fontSize: 11,
                cursor: "grab",
                zIndex: isDragging ? 10 : 1,
                touchAction: "none",
                overflow: "hidden",
              }}
            >
              {f.kind === "gap" ? "hueco" : f.label}
            </button>
          );
        })}
        {placed.map((s) => {
          const isDragging = drag?.seatId === s.id;
          const left = isDragging ? drag!.x : s.posX! * CELL;
          const top = isDragging ? drag!.y : s.posY! * CELL;
          const isSel = selected === s.id;
          return (
            <button
              key={s.id}
              onPointerDown={(e) => onPointerDown(e, s)}
              style={{
                position: "absolute",
                left,
                top,
                width: CELL - 10,
                height: CELL - 10,
                margin: 5,
                borderRadius: 8,
                border: isSel ? "2px solid #fff" : s.isNew ? "1px dashed #fff" : "1px solid #2b313c",
                background: colorOf(s.ticketTypeId),
                color: "#0c1016",
                fontWeight: 600,
                fontSize: 13,
                cursor: "grab",
                zIndex: isDragging ? 10 : 1,
                touchAction: "none",
              }}
            >
              {s.fila}
              {s.numero}
            </button>
          );
        })}
      </div>

      {/* Bandeja de sin ubicar */}
      {unplaced.length > 0 && (
        <div style={{ margin: "8px 0" }}>
          <p style={{ fontSize: 12, color: "#7a8190" }}>Sin ubicar (pulsa para colocar):</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {unplaced.map((s) => (
              <button
                key={s.id}
                onClick={() => placeUnplaced(s)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px dashed #3a4150",
                  background: "#171a21",
                  color: "#e9edf2",
                  cursor: "pointer",
                }}
              >
                {s.fila}
                {s.numero}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
        <button
          onClick={save}
          disabled={saving || !dirty}
          style={{
            padding: "10px 22px",
            borderRadius: 8,
            border: "none",
            background: dirty ? "#3ecf8e" : "#2b313c",
            color: dirty ? "#08130d" : "#7a8190",
            fontWeight: 600,
            fontSize: 15,
            cursor: dirty ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Guardando…" : "Guardar plano"}
        </button>
        {msg && <span style={{ color: "#3ecf8e", fontSize: 14 }}>{msg}</span>}
        {error && <span style={{ color: "#ff6b6b", fontSize: 14 }}>{error}</span>}
        {dirty && !saving && <span style={{ color: "#e0a23c", fontSize: 13 }}>cambios sin guardar</span>}
      </div>
    </div>
  );
}

const field: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid #2b313c",
  background: "#0f1115",
  color: "#e9edf2",
  fontSize: 13,
};

const toolBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #2b313c",
  background: "#171a21",
  color: "#e9edf2",
  cursor: "pointer",
  fontSize: 13,
};
