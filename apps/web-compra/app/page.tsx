import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <h1>Web de compra</h1>
      <p>Demostración de la tienda pública multi-tenant.</p>
      <Link href="/demo" style={{ color: "var(--accent)" }}>
        Ver eventos del promotor «demo» →
      </Link>
    </main>
  );
}
