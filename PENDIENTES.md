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
| 6 | ⏭️ **Siguiente** — **Redsys + Bizum** (pasarela española) — pedir ya al banco el TPV virtual | Pendiente |
| 7 | IVA y facturas (pestaña «Facturación»): emite el promotor; IVA por tipo de entrada (10 % por defecto); simplificada ≤ 400 €, completa (obligatoria > 400 €), canje y rectificativas; numeración sin huecos, registro encadenado VERI*FACTU y libro registro en CSV. Ver [FACTURACION.md](FACTURACION.md) — **revisar con la gestoría** | ✅ Hecho |

Después de producción (por importancia): emails en HTML y plantillas de entrada
personalizables · «Añadir al calendario» (.ics) y recordatorios · Apple/Google Wallet ·
eventos de varios días y reservas por franja horaria · área del comprador (volver a
descargar entradas) · calendario/listado incrustable en otras webs · salida y reentrada
(check-out) · integraciones (Zoom, Mailchimp) · acreditaciones, terminología propia,
prefijo de número de entrada · Stripe Connect / planes y comisiones para promotores ·
directorio de promotores en la portada `/` (hoy es una demo fija).

### Huecos conocidos de lo ya hecho
> Limitaciones de lo que ya funciona. Se apuntan aquí en cuanto aparecen y se quitan al
> resolverlas. **Antes del paso a producción se repasa la lista y se resuelve lo que quede.**

- **Entradas vendidas antes del 2026-10-04** no tienen guardado lo pagado (`price_cents`
  null): al devolverlas se propone la parte proporcional del pedido.
- **Devoluciones de Stripe «pendientes»** se dan por hechas: no se sigue por webhook el raro
  caso de que fallen después (`refund.failed`).
- **Devolución de una venta con datáfono** (TPV) se trata como «en mano»: falta devolver por
  el propio datáfono cuando haya uno real.
- No hay «devolver el pedido entero» desde una entrada: se anula entrada a entrada (o todo
  el evento si se cancela).
- **VERI*FACTU incompleto**: falta enviar los registros a la AEAT, el QR y la leyenda en la
  factura y la declaración responsable. Obligatorio desde 1-1-2027 (sociedades) / 1-7-2027
  (autónomos). Detalle en FACTURACION.md.
- La **taquilla** no pide datos para factura completa (> 400 € se canjea después).
- El **comprador** no puede pedir factura completa tras comprar (lo hace el promotor).
- La lista de tipos de entrada pone «IVA» aunque el promotor esté en IGIC (la factura sí
  dice IGIC).
- **Comisiones de la plataforma**: cuando se cobren, facturarlas al promotor (21 %).
- TicketBAI (País Vasco) y SII no están contemplados.
- Invitaciones en numerado: se asignan los primeros asientos libres; no se pueden elegir.
- **Taquilla** no pide los datos de asistentes al vender en mostrador.
- Plano de la tienda: un asiento vendido antes de abrir la página sale «ocupado» en vez de
  «vendido».
- **Imágenes**: las sustituidas no se borran (huérfanas); falta adaptador S3/R2 para producción.

### Seguridad y RGPD (ver SECURITY_AUDIT.md)
- 🟠 **H4 RGPD**: texto legal y consentimiento en el formulario, plazo de conservación y
  borrado tras el evento, derechos de acceso/supresión; borrar `hold_seat.attendee` de
  reservas no pagadas.
- 🟠 **A2**: test automático que falle si una tabla con `tenant_id` no tiene RLS + CI.
- 🟠 **E1/G1**: la clave que firma los QR se guarda en claro y la app de acceso la descarga
  (cifrado en reposo, rotación, clave por dispositivo).
- 🟡 **C2**: validación de entrada en el resto de la API (la gestión de eventos ya valida).
- 🟢 **D5**: health check que compruebe Postgres y Redis.
- 🟠 **Límite de peticiones** (no hay ninguno en la API): sobre todo en el login y en
  `shop/:slug/coupons/quote`, que permitiría probar códigos de descuento a fuerza bruta.

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
- La BD es compartida y ya tiene la migración **0014** (facturación; 0013 reembolsos, 0012
  cupones, 0011 datos de asistentes). Para que
  Darrian/Raquel tengan el código al día: en su ventana, «trae los cambios de main»
  (`git merge main`).
