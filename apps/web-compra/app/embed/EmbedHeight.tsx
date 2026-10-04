"use client";

import { useEffect } from "react";

/**
 * Dentro de un módulo incrustado (iframe), avisa a la web del promotor de la altura del
 * contenido para que el iframe crezca o encoja sin barras de desplazamiento. Lo escucha
 * `embed.js`. Solo se envía la altura y la ruta: nada de datos del comprador.
 */
export default function EmbedHeight() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () =>
      window.parent.postMessage(
        { type: "entradas:height", height: Math.ceil(document.documentElement.scrollHeight), path: location.pathname },
        "*",
      );
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
