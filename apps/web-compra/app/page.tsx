import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Web de compra</h1>
      <p>Demostración de la tienda pública multi-tenant.</p>
      <Link href="/demo" style={{ color: "#5b9dff" }}>
        Ver eventos del promotor «demo» →
      </Link>
    </main>
  );
}
