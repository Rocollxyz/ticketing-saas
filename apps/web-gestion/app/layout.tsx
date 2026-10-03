import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Gestión de eventos",
  description: "Consola del promotor",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          background: "#0f1115",
          color: "#e9edf2",
        }}
      >
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px" }}>{children}</div>
      </body>
    </html>
  );
}
