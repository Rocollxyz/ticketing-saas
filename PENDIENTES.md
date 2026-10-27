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

### Teatros: funciones y lo que falta frente a Bacantix (2026-10-04)
- ✅ **Varias funciones de un espectáculo**: pestaña «Funciones» en la consola (añadir otra
  fecha copia entradas, precios —con la anticipada desplazada—, plano, huecos y formulario;
  nace en borrador). Cada función es un evento con su aforo, ventas, estado y liquidación.
  «Aplicar también a las demás funciones» en Detalles (textos, imagen, recinto, normas; no
  fechas). Tienda: una sola tarjeta por espectáculo («3 funciones · 28–30 dic») y «Elige
  función» en la ficha (bloqueado con entradas reservadas). Tabla `event_series` +
  `event.series_id` (migración 0019).
- **Hueco**: en la lista de eventos de la consola las funciones salen como filas sueltas con
  el mismo nombre (se distinguen por fecha); agruparlas cuando haya muchas.
- ✅ **Tarifas** (jubilado, estudiante, infantil…): en «Entradas», rebaja en % o importe
  sobre el precio vigente de la categoría (también el anticipado), limitable a categorías,
  con requisito («Presentar DNI») y atajos con las habituales. El comprador elige la tarifa
  por butaca (desplegable) o por cantidad en las generales («Pista · Jubilado»); el requisito
  se avisa al comprar y sale en la entrada (PDF), en la factura («tarifa Jubilado»), en
  «Asistentes» y al validar el QR. Taquilla: botones de tarifa por entrada. El código de
  descuento se aplica sobre el precio ya rebajado. Se copian al duplicar y en funciones
  nuevas. Tabla `fare`, `hold_seat.fare_id`, `ticket.fare_id/fare_name` (migración 0020).
- **Huecos tarifas**: (1) cambiar una tarifa en una función no se aplica a las demás
  (hay que editarlas en cada una); (2) sin cupo por tarifa (p. ej. «máx. 20 jubilados»);
  (3) la app de control de acceso aún no existe en el repo: la API ya devuelve
  `fare`/`requirement` al escanear, falta mostrarlo cuando se haga.
- **App de acceso: ideas del usuario (2026-10-25)**. Apartado de **pendientes por validar**:
  número (validadas / vendidas / faltan) y vista visual (plano coloreado en numerado, barras
  por categoría/zona en general, ritmo de entrada y previsión). Más propuestas en la
  conversación de esa fecha: búsqueda y validación manual (por nombre/pedido/asiento, pedido
  entero), pantalla de resultado grande con categoría/tarifa/requisito y, si está repetida,
  cuándo y por qué puerta entró; puertas/zonas por dispositivo; panel del responsable de
  sala (dispositivos, ritmo por puerta, alertas de rechazos); notas de incidencias; informe
  final (asistencia, no presentados).
- **Con la app de acceso**: apartado «Equipo» en la consola del promotor para dar de alta,
  cambiar de rol (gestor, taquillero, portero) y quitar el acceso a su gente. Hoy solo el
  admin de plataforma crea promotores; los usuarios extra salen del seed (decidido 2026-10-25).
- Corregido de paso: el presupuesto con código de descuento ignoraba los asientos cuando
  el pedido mezclaba asientos y entradas sin asiento.
- Después: abonos, gastos de gestión, taquilla profesional (cierre de caja, impresión
  térmica, grupos), liquidaciones por función, planos reales (línea Raquel).

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

### CRM (estrategia acordada 2026-10-25)
- **Un CRM por promotor** («tus clientes son tuyos»), acotado a eventos: lo que un CRM
  genérico no sabe (compras, asistencia real por los escaneos, tarifas, códigos). Lo demás,
  exportar e integrar. Apunta a **marca blanca** (decisión formal aún pendiente, ver arriba).
  Posible plan de pago (básico / con CRM).
- **El centro es la ficha de cliente** (por email, dentro del promotor): compras, gasto,
  asistencia («compró 6, vino 5»), tarifas y códigos, historial de entradas, etiquetas y
  notas. Los campos del formulario de asistentes (código postal, año de nacimiento, nº de
  socio…) alimentan el CRM.
- **Usos, no solo email**: venta (preventa privada por segmento, tarifas de socio/fidelidad,
  límite por persona entre pedidos, lista de espera de agotados, renovación de butaca de
  abonados); taquilla (buscar cliente, su tarifa, sus notas); puerta (avisos al escanear:
  VIP, prensa, accesibilidad); atención al cliente (ficha única, detectar abusos);
  programación (público por tipo de evento, cuándo compran, procedencia, no presentados);
  **informes de público agregados y anónimos para patrocinadores y subvenciones**; socios y
  comunidad (cuotas, ventajas); avisos de servicio por SMS/WhatsApp/Wallet.
- **Legal**: casilla de consentimiento para publicidad (sin marcar, guardando cuándo y con qué
  texto) y baja de un clic; excepción de clientes para eventos similares. No todo necesita
  ese permiso (preventas, avisos de servicio, notas: contrato/interés legítimo). Accesibilidad
  = dato de salud → consentimiento explícito.
- **Campañas masivas**: recomendado proveedor especializado (Brevo/Mailchimp) aparte del
  servicio propio de emails de entradas; límites por promotor y bloqueo por quejas. Sin decidir.
- **Orden**: (1) ficha, etiquetas, notas y segmentos; (2) usos en venta y puerta; (3) informes
  de público; (4) socios y abonos; (5) campañas y automatizaciones.

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

- **QR filtrado**: no se puede dar a una entrada un código nuevo que invalide el anterior
  (reenviar manda el mismo QR); hoy solo cabe anularla y emitir otra.

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
- ✅ **JWT_SECRET** (2026-10-27): con `NODE_ENV=production` la API no arranca sin un
  secreto propio (antes usaba en silencio el de desarrollo, público en el repo).
- 🟠 **Contraseñas del seed**: el seed es la única forma de crear el admin de plataforma y
  lo hace con contraseñas fijas (`root1234`…); no hay cambio de contraseña en la app. En un
  servidor hay que cambiarlas a mano tras el seed (README §Despliegue). Falta un alta del
  admin de plataforma por variable de entorno y «cambiar contraseña» en las consolas.
- 🟠 **Emails en producción**: solo existe `FileEmailProvider` (escribe en disco); en un
  servidor las entradas no llegan al comprador hasta que se haga el servicio propio.

### Defensa en producción (ver OPERACIONES.md, 2026-10-25)
- Alertas y monitorización (dinero, ataques, salud técnica).
- Verificación en dos pasos para promotores y, sobre todo, admin de plataforma.
- Interruptor general para parar todas las ventas.
- Registro de accesos al admin de plataforma.
- CDN/WAF delante de la tienda y, más adelante, cola virtual.
- Next 16 (quedan 5 avisos de `npm audit` que solo arregla esa versión).

### Plan contra bots (acordado 2026-10-25)
- **Hoy**: límite por pedido; reserva de 10 min; por IP 30 reservas y 20 pagos cada 10 min,
  15 códigos de descuento; login limitado por cuenta e IP. Falta todo lo de abajo.
- **Antes del lanzamiento**: Cloudflare delante (detección de bots); **Turnstile** solo en
  reservar, pagar e iniciar sesión; **una reserva activa por persona y evento**; alertas
  (reservas sin pago desde un mismo origen, pagos rechazados en serie).
- **Primeros eventos con demanda**: **límite por persona entre pedidos** (email, tarjeta,
  nombre del asistente: lo que más frena a los revendedores); «modo salida a la venta»
  (reserva de 5 min, reglas más estrictas; pedir email antes de reservar).
- **Eventos grandes**: cola virtual con orden aleatorio al abrir; preventa por código o para
  clientes del promotor (CRM); entradas nominativas con DNI en la puerta; QR enviado unos días
  antes del evento.
- **Largo plazo**: QR dinámico y reventa oficial a precio controlado.

### Para desplegar (2026-10-25)
- **Tareas de fondo con una sola instancia**: el worker del `outbox` (emails, facturas,
  devoluciones) lee filas sin bloquearlas (sin `FOR UPDATE SKIP LOCKED`); con dos réplicas de
  la API se procesarían dos veces (emails duplicados). Separar un proceso `worker` único
  (outbox, sweeper de reservas, retención RGPD) de la API, o reclamar filas con bloqueo.
- Dockerfiles (no hay ninguno), Next en modo `standalone`, migraciones en cada despliegue,
  adaptador S3 para imágenes, entorno de pruebas (staging).

### Paso a producción (sin decidir)
- Sistema propio de despliegue: hosting, dominios, CI/CD, secretos, copias de seguridad
  de la BD, monitorización y logs.
- ✅ Remoto privado en GitHub: `Rocollxyz/ticketing-saas` (2026-10-27, solo `main`; las
  ramas `darrian` y `raquel` siguen solo en local). Guía de VPS en el README.

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
- La BD es compartida y ya tiene la migración **0020** (tarifas; 0019 funciones de un espectáculo; 0018 huecos/elementos del plano; 0017 eventos mixtos; 0016 tema de la tienda; 0015 RGPD; 0014 facturación, 0013
  reembolsos, 0012 cupones, 0011 datos de asistentes). Las claves de QR están cifradas:
  las ventanas de Darrian/Raquel necesitan la misma `MASTER_KEY` en su `.env`. Para que
  Darrian/Raquel tengan el código al día: en su ventana, «trae los cambios de main»
  (`git merge main`).
