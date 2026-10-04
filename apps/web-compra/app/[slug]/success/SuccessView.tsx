import Link from "next/link";
import { confirmReturn, fetchConfirmation } from "../../../lib/api";

type Search = {
  event?: string;
  order?: string;
  pay?: string;
  ko?: string;
  Ds_SignatureVersion?: string;
  Ds_MerchantParameters?: string;
  Ds_Signature?: string;
};

/** Resultado de la compra. `base`: `/promotor` o `/embed/promotor` (dentro del módulo incrustado). */
export default async function SuccessView({ slug, base, searchParams }: { slug: string; base: string; searchParams: Promise<Search> }) {
  const q = await searchParams;

  // Vuelta desde Redsys (tarjeta/Bizum): el resultado viene firmado en la URL.
  let eventId = q.event;
  let state: "ok" | "pending" | "failed" = "ok";
  if (q.pay === "redsys" && q.order) {
    const signed = Object.fromEntries(
      (["Ds_SignatureVersion", "Ds_MerchantParameters", "Ds_Signature"] as const)
        .filter((k) => q[k])
        .map((k) => [k, q[k]!]),
    );
    const st = await confirmReturn(slug, q.order, signed);
    eventId = st?.eventId ?? eventId;
    state = st?.status === "PAID" ? "ok" : q.ko || st?.status === "CANCELLED" ? "failed" : "pending";
  }
  const info = eventId ? await fetchConfirmation(slug, eventId) : null;

  if (state === "failed") {
    return (
      <main className="page" style={{ textAlign: "center", paddingTop: 60 }}>
        <div style={{ fontSize: 56 }}>⚠️</div>
        <h1>El pago no se ha completado</h1>
        {info && <p style={{ fontSize: 18, margin: "0 0 8px" }}>{info.name}</p>}
        <p style={{ opacity: 0.8 }}>No se ha cobrado nada. Tus entradas se liberarán en unos minutos.</p>
        <Link href={eventId ? `${base}/event/${eventId}` : base} style={{ color: "var(--accent)" }}>
          ← Volver a intentarlo
        </Link>
      </main>
    );
  }

  return (
    <main className="page" style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 56 }}>🎟️</div>
      <h1>{state === "pending" ? "Estamos confirmando tu pago…" : "¡Compra completada!"}</h1>
      {info && <p style={{ fontSize: 18, margin: "0 0 8px" }}>{info.name}</p>}
      <p style={{ opacity: 0.8 }}>
        {state === "pending"
          ? "El banco aún no nos ha confirmado el pago. En cuanto lo haga recibirás las entradas por email."
          : "Tus entradas se están emitiendo. Recibirás el PDF con el código QR por email."}
      </p>
      {info?.message && state === "ok" && (
        <p
          style={{
            whiteSpace: "pre-wrap",
            background: "var(--surface)",
            borderRadius: 10,
            padding: 16,
            textAlign: "left",
            margin: "24px auto",
            maxWidth: 520,
          }}
        >
          {info.message}
        </p>
      )}
      <Link href={base} style={{ color: "var(--accent)" }}>
        ← Volver a los eventos
      </Link>
    </main>
  );
}
