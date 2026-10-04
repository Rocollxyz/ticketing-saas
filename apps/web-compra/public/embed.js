/*
 * Venta de entradas en la web del promotor. Se pega UNA vez:
 *
 *   <script src="https://TIENDA/embed.js" async></script>
 *
 * y después, donde se quiera:
 *
 *   <div data-entradas-cartelera="PROMOTOR"></div>          → cartelera con compra
 *   <div data-entradas-evento="PROMOTOR/EVENTO"></div>       → un evento con compra
 *   <a data-entradas-comprar="PROMOTOR/EVENTO">Entradas</a>  → abre la compra en una ventana
 *                                                              flotante sobre la web
 *
 * Los módulos ajustan su altura solos. También: window.Entradas.abrir("PROMOTOR/EVENTO").
 * Sin dependencias, sin cookies y sin datos del comprador en la web del promotor: todo
 * ocurre dentro del iframe de la tienda.
 */
(function () {
  "use strict";
  if (window.Entradas) return;

  var script = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var ORIGIN = script ? new URL(script.src, location.href).origin : location.origin;

  function url(ref) {
    var parts = String(ref || "").split("/").filter(Boolean).map(encodeURIComponent);
    if (!parts[0]) return null;
    return ORIGIN + "/embed/" + parts[0] + (parts[1] ? "/event/" + parts[1] : "");
  }

  function frame(src, title) {
    var f = document.createElement("iframe");
    f.src = src;
    f.title = title;
    f.loading = "lazy";
    f.allow = "payment"; // Apple Pay / Google Pay dentro del iframe
    f.style.cssText = "width:100%;border:0;display:block;color-scheme:normal;";
    return f;
  }

  // ─── Módulos incrustados ─────────────────────────────────────────────
  function mount(el, ref, title) {
    var src = url(ref);
    if (!src || el.getAttribute("data-entradas-listo")) return;
    el.setAttribute("data-entradas-listo", "1");
    var f = frame(src, title);
    f.style.height = (el.getAttribute("data-alto") || 600) + "px";
    f.setAttribute("data-entradas-auto", "1");
    el.appendChild(f);
  }

  // La tienda avisa de su altura: se ajusta el iframe que envió el mensaje.
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== "entradas:height") return;
    var frames = document.querySelectorAll("iframe[data-entradas-auto]");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.max(200, Math.min(e.data.height, 20000)) + "px";
      }
    }
  });

  // ─── Ventana flotante de compra ──────────────────────────────────────
  var overlay = null;
  var lastFocus = null;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function open(ref) {
    var src = url(ref);
    if (!src) return;
    close();
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Compra de entradas");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:rgba(15,17,21,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:2vh 2vw;backdrop-filter:blur(2px);";
    var box = document.createElement("div");
    var small = window.innerWidth < 700;
    box.style.cssText =
      "position:relative;background:#fff;border-radius:" + (small ? "0" : "16px") + ";overflow:hidden;" +
      "width:" + (small ? "100vw;height:100%" : "min(1180px,96vw);height:92vh") + ";" +
      "box-shadow:0 30px 80px rgba(0,0,0,.35);" + (small ? "margin:-2vh -2vw;" : "");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Cerrar");
    btn.textContent = "×";
    btn.style.cssText =
      "position:absolute;top:10px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;" +
      "background:rgba(255,255,255,.92);box-shadow:0 2px 10px rgba(0,0,0,.2);font:600 24px/38px system-ui;" +
      "color:#121826;cursor:pointer;";
    btn.onclick = close;
    var f = frame(src, "Compra de entradas");
    f.style.height = "100%";
    f.loading = "eager";
    box.appendChild(f);
    box.appendChild(btn);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    btn.focus();
  }

  // ─── Arranque (y elementos añadidos después, p. ej. webs con JavaScript) ─
  function scan(root) {
    var list = (root || document).querySelectorAll("[data-entradas-cartelera],[data-entradas-evento],[data-entradas-comprar]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.hasAttribute("data-entradas-cartelera")) mount(el, el.getAttribute("data-entradas-cartelera"), "Cartelera y venta de entradas");
      else if (el.hasAttribute("data-entradas-evento")) mount(el, el.getAttribute("data-entradas-evento"), "Venta de entradas");
      else if (!el.getAttribute("data-entradas-listo")) {
        el.setAttribute("data-entradas-listo", "1");
        el.addEventListener("click", function (e) {
          e.preventDefault();
          open(this.getAttribute("data-entradas-comprar"));
        });
      }
    }
  }

  window.Entradas = { abrir: open, cerrar: close, iniciar: scan };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
  if (window.MutationObserver) {
    new MutationObserver(function () { scan(); }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
