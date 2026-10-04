import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./shop.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "Entradas",
  description: "Web de compra de entradas",
};

/** Cada página elige su contenedor: `.page` (columna de lectura) o `.page-wide` (ficha de evento). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
