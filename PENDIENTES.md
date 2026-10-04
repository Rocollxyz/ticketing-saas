# Pendientes

> Resumen de todo lo que queda por hacer, para retomar en otra sesión.
> Actualizado: 2026-10-04. Detalle técnico en [ARCHITECTURE.md](ARCHITECTURE.md),
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md) y [LINEAS_DE_TRABAJO.md](LINEAS_DE_TRABAJO.md).

## Cómo retomar

```bash
cd ~/vscode/ticket            # rama main
open -a Docker                # si Docker no está abierto
npm run infra:up              # Postgres + Redis
npm run dev                   # API :3000 + webs :3001 compra, :3002 gestión, :3004 taquilla, :3005 admin
```

- Para que las compras con tarjeta emitan entradas hace falta el reenvío de webhooks de
  Stripe. El login del Stripe CLI caducó (23-09-2026); usar la clave del `.env`:
  `stripe listen --api-key "$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)" --forward-to localhost:3000/webhooks/stripe`
- Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura y CVC.
- Credenciales demo: promotor `admin@demo.test`/`demo1234` (slug `demo`), taquilla
  `taquillero@demo.test`/`taquillero123`, portero `portero@demo.test`/`portero123`,
  plataforma `root@platform.test`/`root1234`.
- Los emails no se envían: se guardan en `dev-outbox/`.
- Datos del usuario en la BD (no borrar): eventos «El real jamiroquai» y «Noche de Jazz &
  Soul», y sus pedidos.

---

## 1. Línea MAIN (prioridad — va a producción)

### Funcionalidades (orden acordado tras comparar con FooEvents)

| # | Qué | Estado |
|---|---|---|
| 1 | Datos de asistentes + campos personalizados | ✅ Hecho (commit `700bf9c`) |
| 2 | Gestión de entradas en la consola (pestaña «Asistentes»): listar, buscar, editar asistente, reenviar, anular (liberando la plaza), invitaciones, exportar CSV | ✅ Hecho |
| 3 | **Emails reales** | Más adelante: **servicio propio en el servidor** (decidido 2026-10-04; nada de Resend/Brevo/SES). Se hará con el paso a producción |
| 4 | Cupones / códigos de descuento (pestaña «Descuentos»; % o € por entrada, por evento/categorías o para todos los eventos, usos máximos y fechas) | ✅ Hecho |
| 5 | Reembolsos y cancelaciones: anular con devolución (online automática por Stripe; taquilla «por devolver en mano»), devolución en bloque al cancelar un evento, cobros sin plaza devueltos solos, email al comprador. Guarda lo pagado por cada entrada | ✅ Hecho |
| 6 | Redsys + Bizum: varias pasarelas a la vez (tarjeta → `PAYMENTS_PROVIDER`, Bizum → Redsys), el comprador elige; pago por redirección con firma verificada, notificación + confirmación al volver, devolución por REST. Probado de punta a punta en el entorno de pruebas de Redsys (pago real con 3DS y devolución real). **Falta el contrato de TPV virtual con el banco** para producción | ✅ Hecho |
| 7 | IVA y facturas (pestaña «Facturación»): emite el promotor; IVA por tipo de entrada (10 % por defecto); simplificada ≤ 400 €, completa (obligatoria > 400 €), canje y rectificativas; numeración sin huecos, registro encadenado VERI*FACTU y libro registro en CSV. Ver [FACTURACION.md](FACTURACION.md) — **revisar con la gestoría** | ✅ Hecho |

Después de producción (por importancia): emails en HTML y plantillas de entrada
personalizables · «Añadir al calendario» (.ics) y recordatorios · Apple/Google Wallet ·
eventos de varios días y reservas por franja horaria · área del comprador (volver a
descargar entradas) · calendario/listado incrustable en otras webs · salida y reentrada
(check-out) · integraciones (Zoom, Mailchimp) · acreditaciones, terminología propia,
prefijo de número de entrada · Stripe Connect / planes y comisiones para promotores ·
directorio de promotores en la portada `/` (hoy es una demo fija).

### Eventos mixtos (2026-10-04)
- ✅ Un mismo evento vende entradas **con asiento** (plano) y **sin asiento** (aforo), p. ej.
  platea numerada + pista. El modo es de cada tipo de entrada (`ticket_type.seating`,
  migración 0017); `event.seating_mode` es un resumen derivado. Una sola reserva/pedido/factura
  mezcla asientos y cantidades (`createHoldMixed`). Tienda, taquilla, invitaciones, consola y
  duplicar evento adaptados.
- **Para Raquel (fase 2)**: dibujar la pista/zonas de pie en el plano sobre esto (hoy la pista
  se compra con un selector de cantidad en la caja de compra, no en el plano).
- ✅ **Huecos y elementos del plano** (2026-10-04): en el editor, «+ Hueco (pasillo)» y
  «+ Elemento» (Escalera, Columna, Barra, Salida, Control, Aseos o texto propio), arrastrables
  como las butacas; el comprador ve los huecos como espacio y los elementos con su nombre.
  Tabla `seatmap_feature` (migración 0018). **Para Raquel**: su editor nuevo debe leer y
  guardar estos elementos (o migrarlos a sus formas) para no perderlos.

### Presentación y experiencia del comprador (análisis 2026-10-04)
- ✅ **Ficha de evento estilo Ticketmaster**: cabecera con cartel sin recortar, información en
  el centro y compra en una caja fija a la derecha por pasos (entradas → datos → pago); en
  numerado, el plano en el centro; móvil con barra fija de compra; compartir y añadir al
  calendario; colores del promotor; tipografía Inter e iconos. Es la plantilla «Clásica» de
  Darrian (reutilizar `app/shop.css` como base de su sistema de temas).
- ✅ **Página del promotor** en el mismo estilo: portada con logo, evento destacado (el próximo
  a la venta), cartelera en rejilla de carteles con la fecha encima, filtros en botones
  (fecha, categoría, ciudad), «Sobre…» con contacto y redes a la derecha, eventos pasados.
- ✅ **Integración en la web del promotor** (consola «Integrar en tu web»): `embed.js` +
  `data-entradas-cartelera` / `data-entradas-evento` (módulos que ajustan su altura) y
  `data-entradas-comprar` (compra en ventana flotante). Rutas `/embed/*` (solo esas se dejan
  incrustar: `frame-ancestors`); el pago con tarjeta termina dentro del módulo; Redsys/Bizum y
  métodos con redirección van a la ventana completa. Probado con una web externa y compra real.
- Siguientes, por orden: **Google y redes** (datos estructurados `Event`, imagen para compartir generada, sitemap),
  **dominio propio**
  por promotor, **después de comprar** (entradas visibles, Wallet, calendario) y la **portada
  `/`**. Decisión pendiente del usuario: marca blanca (recomendado) o escaparate propio.
- ✅ **Tema de la tienda**: blanco por defecto (decidido 2026-10-04); el promotor puede elegir
  oscuro en su perfil (`tenant.shop_theme`). El formulario de pago de Stripe sigue el tema.
- **Apple Pay / Google Pay**: aparecen solos en el formulario de Stripe al servir la tienda por
  HTTPS y verificar el dominio (con el despliegue).

### Huecos conocidos de lo ya hecho
> Limitaciones de lo que ya funciona. Se apuntan aquí en cuanto aparecen y se quitan al
> resolverlas. **Antes del paso a producción se repasa la lista y se resuelve lo que quede.**
> Último repaso: 2026-10-04 (resueltos: plano «vendido», IVA/IGIC en la consola, devoluciones
> Redsys sin duplicados, devoluciones de Stripe que fallan después, anular el pedido entero,
> datos de asistentes y factura completa en taquilla).

**Con el despliegue** (se resuelven al montar producción):
- **Redsys**: `PUBLIC_API_URL` público (HTTPS) para la notificación, y credenciales reales
  del banco. En local solo funciona la confirmación al volver el comprador.
- **Stripe**: el webhook de producción debe suscribirse también a `refund.failed` y
  `charge.refund.updated` (devoluciones que fallan después).
- **Imágenes**: adaptador S3/R2 y borrar las sustituidas (hoy quedan huérfanas en disco).

**Dependen de terceros:**
- **VERI*FACTU**: envío a la AEAT (certificado), QR y leyenda en la factura, declaración
  responsable. Obligatorio 1-1-2027 (sociedades) / 1-7-2027 (autónomos). Ver FACTURACION.md.
- **TicketBAI** (País Vasco) y **SII**: según dónde estén los promotores (gestoría).
- **Bizum**: probado hasta la redirección; el pago completo pide un móvil de pruebas del banco.
- **Datáfono real**: la devolución de una venta con tarjeta en taquilla se trata «en mano».

- **Integración web**: `/embed/*` se deja incrustar en CUALQUIER web; limitarlo a los dominios
  que declare cada promotor. La salida a Redsys desde un módulo (ventana completa) no está
  probada con un pago real dentro de un iframe.

- **Plano de la taquilla**: sigue con butacas grandes (56 px); con planos de muchas columnas
  se desborda. Reutilizar el plano compacto de la tienda (`SeatMap.tsx`) o esperar al de Raquel.

**Después de producción:**
- El comprador no puede pedir factura completa tras comprar (lo hace el promotor): llegará
  con el área del comprador.
- Comisiones de la plataforma: facturarlas al promotor (21 %) cuando se cobren.
- Invitaciones en numerado: se asignan los primeros asientos libres; no se pueden elegir.
- La lista de «Asistentes» pone «Online» sin distinguir tarjeta de Bizum.

### Seguridad y RGPD (ver SECURITY_AUDIT.md)
- ✅ Hecho (2026-10-04): límite de peticiones (I1), test anti-fuga RLS + CI (A2), clave de
  QR cifrada en reposo (E1), health check real (D5), RGPD básico (H4: aviso al comprar,
  borrado automático, acceso y supresión en la consola «Privacidad»).
- 🟠 **G1**: la app de acceso descarga la clave de firma descifrada (clave por dispositivo,
  rotación).
- 🟡 **H4 resto**: contrato de encargo del tratamiento con cada promotor, registro de
  actividades y conservación de `order.buyer_email`.
- 🟡 **C2**: validación de entrada en el resto de la API (la gestión de eventos ya valida).
- **MASTER_KEY**: guardarla a salvo; si se pierde, los QR emitidos dejan de validar.

### Paso a producción (sin decidir)
- Sistema propio de despliegue: hosting, dominios, CI/CD, secretos, copias de seguridad
  de la BD, monitorización y logs.
- Repositorio solo local: **añadir un remoto privado** (GitHub/GitLab) como copia de
  seguridad.

---

## 2. Línea DARRIAN (editor de páginas de evento) — rama `darrian`, `~/vscode/ticket-darrian`

- Estado: **fase 0 hecha** (Puck + portada, texto y entradas + renderizador propio;
  laboratorio en :3010).
- Siguiente: **fase 0b** (extraer el selector de compra de la ficha de la tienda a
  componentes reutilizables) y **fase 1** (MVP: ~10 bloques, tema, borrador/publicar).
- Detalle: `DARRIAN.md` en esa rama. Se trabaja en su propia ventana de Claude Code.

## 3. Línea RAQUEL (editor de planos de asientos) — rama `raquel`, `~/vscode/ticket-raquel`

- Estado: **fase 0 hecha** (`packages/raquel` con fila recta/curva, numeración,
  validación y tests + laboratorio Konva en :3011). Falta probarlo en un **móvil real**.
- Siguiente: **fase 1** (MVP: filas, bloques, anfiteatros, numeración pares/impares,
  pintar precios, fondo de calco, vista del comprador).
- Decisiones: Konva; recintos propios del promotor reutilizables; venta mixta en fase 2;
  mesas por silla y por mesa entera.
- Detalle: `RAQUEL.md` en esa rama. Se trabaja en su propia ventana de Claude Code.

## Coordinación entre líneas
- `main` nunca recibe trabajo a medias de Darrian/Raquel; se integrarán cuando estén
  maduras (decisión aparte).
- La BD es compartida y ya tiene la migración **0018** (huecos/elementos del plano; 0017 eventos mixtos; 0016 tema de la tienda; 0015 RGPD; 0014 facturación, 0013
  reembolsos, 0012 cupones, 0011 datos de asistentes). Las claves de QR están cifradas:
  las ventanas de Darrian/Raquel necesitan la misma `MASTER_KEY` en su `.env`. Para que
  Darrian/Raquel tengan el código al día: en su ventana, «trae los cambios de main»
  (`git merge main`).
