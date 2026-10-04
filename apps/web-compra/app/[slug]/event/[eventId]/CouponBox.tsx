"use client";

import { useState } from "react";
import { inputStyle } from "./styles";

export interface AppliedCoupon {
  code: string;
  discountCents: number;
  totalCents: number;
}

/**
 * «¿Tienes un código de descuento?». Pide a la API el total con el código sobre la
 * selección actual (sin reservar); el descuento definitivo se calcula al comprar.
 */
export default function CouponBox({
  applied,
  disabled,
  onApply,
  onRemove,
}: {
  applied: AppliedCoupon | null;
  disabled: boolean;
  onApply: (code: string) => Promise<string | null>;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (applied) {
    return (
      <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--ok)" }}>
        Código <strong>{applied.code}</strong> aplicado.{" "}
        <button onClick={onRemove} style={linkStyle}>
          Quitar
        </button>
      </p>
    );
  }
  if (!open) {
    return (
      <p style={{ margin: "0 0 12px" }}>
        <button onClick={() => setOpen(true)} style={linkStyle}>
          ¿Tienes un código de descuento?
        </button>
      </p>
    );
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(await onApply(code.trim()));
    setBusy(false);
  }

  return (
    <form onSubmit={apply} style={{ marginBottom: 12, fontSize: 14 }}>
      Código de descuento
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={40}
          autoFocus
          autoCapitalize="characters"
          placeholder="CÓDIGO"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          disabled={busy || disabled || !code.trim()}
          style={{
            marginTop: 6,
            padding: "0 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--selected)",
            color: "var(--text)",
            cursor: busy || disabled ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "…" : "Aplicar"}
        </button>
      </div>
      {disabled && <span style={{ color: "var(--faint)", fontSize: 13 }}>Elige primero tus entradas.</span>}
      {error && <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
    </form>
  );
}

const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 14,
};
