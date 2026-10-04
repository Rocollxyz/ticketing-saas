"use client";

import { inputStyle } from "./styles";

export interface BillingInput {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
}

export const EMPTY_BILLING: BillingInput = { name: "", taxId: "", address: "", postalCode: "", city: "" };

/** Completo si todos los campos tienen algo (la API valida el NIF). */
export const billingComplete = (b: BillingInput) => Object.values(b).every((v) => v.trim() !== "");

/**
 * Datos para factura completa. Opcional (empresas y autónomos) salvo que el pedido pase
 * de 400 €: entonces la ley no permite factura simplificada y son obligatorios.
 */
export default function BillingBox({
  enabled,
  required,
  value,
  onEnabled,
  onChange,
}: {
  enabled: boolean;
  required: boolean;
  value: BillingInput;
  onEnabled: (v: boolean) => void;
  onChange: (v: BillingInput) => void;
}) {
  const field = (k: keyof BillingInput, label: string, max: number, flex = 1) => (
    <label style={{ fontSize: 14, flex, minWidth: 140 }}>
      {label}
      <input
        value={value[k]}
        maxLength={max}
        required
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        style={inputStyle}
      />
    </label>
  );
  return (
    <div style={{ marginBottom: 16, fontSize: 14 }}>
      {required ? (
        <p style={{ margin: "0 0 8px", color: "#e0a23c" }}>
          Para compras de más de 400 € la ley exige factura completa: indica tus datos de facturación.
        </p>
      ) : (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
          Necesito factura a nombre de una empresa o autónomo
        </label>
      )}
      {(enabled || required) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px" }}>
          {field("name", "Nombre o razón social", 200, 2)}
          {field("taxId", "NIF", 20)}
          {field("address", "Dirección", 300, 2)}
          {field("postalCode", "Código postal", 10)}
          {field("city", "Población", 100)}
        </div>
      )}
    </div>
  );
}
