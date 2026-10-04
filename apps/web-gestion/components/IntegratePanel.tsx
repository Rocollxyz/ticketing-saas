"use client";

import { useEffect, useState } from "react";
import { listEvents, type PromoterEvent, SHOP_URL } from "../lib/api";

/**
 * Código para vender desde la web del promotor: el script (una vez) y, donde quiera, la
 * cartelera incrustada, un evento incrustado o un botón que abre la compra en una ventana
 * flotante. Con vista previa de la cartelera.
 */
export default function IntegratePanel({ token, slug }: { token: string; slug: string }) {
  const [events, setEvents] = useState<PromoterEvent[]>([]);
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    listEvents(token)
      .then((list) => {
        const sellable = list.filter((e) => e.status === "ON_SALE" || e.status === "CLOSED");
        setEvents(sellable);
        setEventId((cur) => cur || sellable[0]?.id || "");
      })
      .catch(() => setEvents([]));
  }, [token]);

  const script = `<script src="${SHOP_URL}/embed.js" async></script>`;
  const ref = `${slug}/${eventId}`;
  const ev = events.find((e) => e.id === eventId);

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Vende desde tu propia web sin que el comprador salga de ella. Funciona en cualquier web (WordPress, Wix,
        Squarespace, HTML…): pega el script <strong>una vez</strong> y luego, donde quieras, el bloque que prefieras.
        Las ventas, facturas y entradas son las mismas que en tu tienda.
      </p>

      <Snippet
        step="1"
        title="Pega esto una vez en tu web"
        hint="Antes de cerrar </body>, o en el apartado «código personalizado» de tu gestor de web."
        code={script}
      />

      <Snippet
        step="2"
        title="Tu cartelera con venta"
        hint="Todos tus eventos a la venta, con buscador y filtros. Se ajusta de alto sola."
        code={`<div data-entradas-cartelera="${slug}"></div>`}
      />

      <div className="card stack" style={{ gap: 10 }}>
        <h3 className="section-title" style={{ margin: 0 }}>3 · Un evento concreto</h3>
        {events.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Cuando tengas un evento publicado, aquí tendrás su código.
          </p>
        ) : (
          <>
            <label className="field" style={{ maxWidth: 420 }}>
              Evento
              <select className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <Snippet
              title="Botón «Comprar entradas»"
              hint="Abre la compra en una ventana flotante encima de tu web. Puedes poner el atributo en tu propio botón o enlace."
              code={`<a href="#" data-entradas-comprar="${ref}">Comprar entradas</a>`}
              plain
            />
            <Snippet
              title="Ficha del evento incrustada"
              hint={`Información de «${ev?.name ?? ""}» y la compra, dentro de tu página.`}
              code={`<div data-entradas-evento="${ref}"></div>`}
              plain
            />
          </>
        )}
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Vista previa de la cartelera</h3>
        <span className="faint">Así se verá dentro de tu web (con el tema y el color de tu perfil).</span>
        <iframe
          title="Vista previa"
          src={`${SHOP_URL}/embed/${slug}`}
          style={{ width: "100%", height: 560, border: "1px solid var(--border)", borderRadius: 10, background: "#fff" }}
        />
      </div>

      <p className="faint" style={{ margin: 0 }}>
        Los pagos con tarjeta se hacen dentro de tu web. Bizum y algunos bancos abren su página a pantalla completa y,
        al terminar, el comprador vuelve a la confirmación de la tienda.
      </p>
    </div>
  );
}

function Snippet({
  step,
  title,
  hint,
  code,
  plain,
}: {
  step?: string;
  title: string;
  hint: string;
  code: string;
  plain?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  const body = (
    <>
      <div className="row" style={{ alignItems: "baseline" }}>
        <strong style={{ fontSize: plain ? 14 : 15 }}>{step ? `${step} · ${title}` : title}</strong>
        <span className="spacer" />
        <button type="button" className="btn" onClick={copy}>
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <span className="faint">{hint}</span>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          borderRadius: 8,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        <code>{code}</code>
      </pre>
    </>
  );
  return plain ? <div className="stack" style={{ gap: 6 }}>{body}</div> : <div className="card stack" style={{ gap: 6 }}>{body}</div>;
}
