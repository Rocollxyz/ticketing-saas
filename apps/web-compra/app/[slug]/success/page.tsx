import Link from "next/link";
import { fetchConfirmation } from "../../../lib/api";

export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { slug } = await params;
  const { event } = await searchParams;
  const info = event ? await fetchConfirmation(slug, event) : null;

  return (
    <main style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 56 }}>🎟️</div>
      <h1>¡Compra completada!</h1>
      {info && <p style={{ fontSize: 18, margin: "0 0 8px" }}>{info.name}</p>}
      <p style={{ opacity: 0.8 }}>
        Tus entradas se están emitiendo. Recibirás el PDF con el código QR por email.
      </p>
      {info?.message && (
        <p
          style={{
            whiteSpace: "pre-wrap",
            background: "#171a21",
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
      <Link href={`/${slug}`} style={{ color: "#5b9dff" }}>
        ← Volver a los eventos
      </Link>
    </main>
  );
}
