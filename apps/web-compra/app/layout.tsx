import type { ReactNode } from "react";

export const metadata = {
  title: "Entradas",
  description: "Web de compra de entradas",
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
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
          {children}
        </div>
      </body>
    </html>
  );
}
