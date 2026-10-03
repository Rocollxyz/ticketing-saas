"use client";

import { useRef, useState } from "react";
import { type ImageKind, uploadImage } from "../lib/api";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";

/**
 * Campo de imagen: subir desde el ordenador (botón o arrastrar y soltar), ver la vista
 * previa, quitarla o —como alternativa— pegar una URL. El valor es siempre una URL.
 */
export default function ImageField({
  token,
  kind,
  label,
  hint,
  value,
  onChange,
  aspect = "16 / 9",
}: {
  token: string;
  kind: ImageKind;
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  /** Proporción de la vista previa (la imagen no se recorta al guardarla). */
  aspect?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Elige un archivo de imagen (JPG, PNG, WebP…)");
    if (file.size > 10 * 1024 * 1024) return setError("La imagen supera los 10 MB");
    setBusy(true);
    try {
      const { url } = await uploadImage(token, file, kind);
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir la imagen");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="field">
      {label}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files[0]);
        }}
        onClick={() => !busy && !value && input.current?.click()}
        style={{
          position: "relative",
          aspectRatio: aspect,
          maxHeight: kind === "logo" ? 160 : 220,
          borderRadius: 10,
          border: `1px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
          background: value ? `center/contain no-repeat url("${value}") var(--bg)` : drag ? "#5b9dff11" : "var(--bg)",
          display: "grid",
          placeItems: "center",
          cursor: value ? "default" : "pointer",
          overflow: "hidden",
        }}
      >
        {!value && (
          <span className="faint" style={{ textAlign: "center", padding: 12 }}>
            {busy ? "Subiendo…" : "Arrastra una imagen aquí o haz clic para elegirla"}
          </span>
        )}
        {value && busy && (
          <span style={{ background: "#000a", padding: "6px 10px", borderRadius: 6, fontSize: 13 }}>Subiendo…</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {value ? "Cambiar imagen" : "Subir imagen"}
        </button>
        {value && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => onChange("")}>
            Quitar
          </button>
        )}
        <button type="button" className="btn link" onClick={() => setShowUrl((v) => !v)} style={{ fontSize: 12 }}>
          {showUrl ? "ocultar URL" : "o pegar una URL"}
        </button>
      </div>
      {showUrl && (
        <input
          className="input"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
      )}
      {hint && <span className="hint">{hint}</span>}
      {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
