# Ticketing SaaS

Plataforma **multi-promotor** de venta y control de entradas: venta online, venta en
taquilla, control de acceso en la puerta y gestión completa del evento por parte del
promotor. Cada promotor trabaja en su propio espacio aislado y vende con su marca.

Es un monorepo TypeScript (Turborepo) con una API NestJS, cuatro webs Next.js y una app
móvil Expo, sobre PostgreSQL con Row Level Security y Redis.

> Documentación de detalle: [ARCHITECTURE.md](ARCHITECTURE.md) (diseño y modelo de datos),
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (auditoría de seguridad),
> [OPERACIONES.md](OPERACIONES.md) (operación en producción),
> [FACTURACION.md](FACTURACION.md) (IVA, facturas y VERI\*FACTU) y
> [PENDIENTES.md](PENDIENTES.md) (estado y lo que falta).

---

## Índice

1. [Capacidades](#capacidades)
2. [Arquitectura](#arquitectura)
3. [Desarrollo local](#desarrollo-local)
4. [Variables de entorno](#variables-de-entorno)
5. [Despliegue en un servidor](#despliegue-en-un-servidor)
6. [Actualizar una instalación](#actualizar-una-instalación)
7. [Copias de seguridad](#copias-de-seguridad)
8. [Limitaciones conocidas antes de producción](#limitaciones-conocidas-antes-de-producción)

---

## Capacidades

### Tienda online (comprador) — `web-compra`
- **Página del promotor** con su logo, evento destacado, cartelera en rejilla de carteles,
  filtros por fecha, categoría y ciudad, sección «Sobre…» con contacto y redes, y eventos
  pasados. Tema claro u oscuro y colores del promotor.
- **Ficha de evento**: cartel, información, compra por pasos en una caja fija
  (entradas → datos → pago), barra de compra fija en móvil, compartir y añadir al calendario.
- **Plano de asientos en tiempo real**: el comprador elige butaca y ve al instante lo que
  otros reservan o compran (WebSocket). Pasillos y elementos del recinto (escaleras, barra,
  salidas, aseos…) dibujados en el plano.
- **Eventos mixtos**: en un mismo evento, zonas numeradas (platea) y de aforo libre (pista);
  un solo pedido y una sola factura.
- **Espectáculos con varias funciones**: una sola tarjeta por espectáculo y selector de función.
- **Tarifas** (jubilado, estudiante, infantil…) por butaca o por cantidad, con requisito
  («Presentar DNI») que se avisa al comprar y figura en la entrada.
- **Códigos de descuento** (% o importe, por evento o categoría, usos máximos y fechas).
- **Reserva temporal de 10 minutos** mientras se paga: nadie más puede coger esas plazas.
- **Pagos**: tarjeta con **Stripe** o **Redsys**, y **Bizum** por Redsys; el comprador elige.
  Con Stripe, Apple Pay y Google Pay aparecen solos al servir la tienda por HTTPS.
  Si el pago falla, se recupera la reserva y se reintenta.
- **Datos de asistentes** con campos personalizados por evento.
- **Entrega** de la entrada en PDF con QR firmado de un solo uso.
- **Integración en la web del promotor**: script `embed.js` con módulos de cartelera, de
  evento y botón de compra en ventana flotante. Enlace y QR descargable (PNG/SVG) para
  compartir el evento.

### Consola del promotor — `web-gestion`
- Eventos: crear, editar, duplicar, estados (borrador, a la venta, cerrado), funciones con
  «aplicar también a las demás».
- Entradas: categorías, precios con tramo anticipado, aforo, tarifas y formulario de asistentes.
- Editor de plano de asientos, pasillos y elementos.
- **Asistentes**: listar, buscar, editar, reenviar, anular liberando la plaza, invitaciones
  y exportación CSV. **Historial de cada entrada** (pagos, emails, cambios, devoluciones,
  escaneos).
- **Devoluciones y cancelaciones**: anular con devolución automática (Stripe/Redsys),
  devolución en bloque al cancelar un evento y devolución automática de cobros sin plaza.
- **Facturación**: el promotor emite; IVA por tipo de entrada, factura simplificada y
  completa, rectificativas, numeración sin huecos, registro encadenado VERI\*FACTU y libro
  registro en CSV (ver [FACTURACION.md](FACTURACION.md)).
- **Privacidad (RGPD)**: aviso al comprar, borrado automático por plazos, acceso y supresión
  de datos de un comprador.
- Perfil de la tienda (logo, colores, tema, contacto) e «Integrar en tu web».

### Taquilla — `web-taquilla`
- Venta presencial con selección de asiento o cantidad, tarifas por entrada, cobro en mano
  y datos de asistente/factura completa.

### Control de acceso — `acceso-movil` (Expo / React Native)
- Escaneo y validación de QR en la puerta; muestra categoría, tarifa y requisito.
- Funciona **sin conexión**: descarga la lista del evento y sincroniza los escaneos después.
- Detecta entradas repetidas o falsificadas (registro de escaneos solo de añadir).

### Administración de la plataforma — `web-admin`
- Alta y listado de promotores (con su usuario administrador).

### Seguridad
- **Aislamiento entre promotores en la base de datos** (Row Level Security con rol sin
  privilegios), con test automático anti-fuga en CI.
- Roles: promotor, taquillero, portero y admin de plataforma.
- QR firmados con clave por evento, **cifrada en reposo** (AES-256-GCM con `MASTER_KEY`).
- Webhooks de pago verificados por firma e idempotentes; nunca se guardan datos de tarjeta
  (PCI-DSS SAQ-A).
- Límites de peticiones por IP y por cuenta (reservas, pagos, códigos, login).
- Solo las rutas `/embed/*` pueden incrustarse en otra web (protección contra clickjacking).

---

## Arquitectura

```
                         ┌──────────────┐
  Comprador ───────────▶ │ web-compra   │ :3001 ┐
  Promotor  ───────────▶ │ web-gestion  │ :3002 │
  Taquillero ──────────▶ │ web-taquilla │ :3004 ├──▶  API NestJS :3000 ──▶ PostgreSQL 17 (RLS)
  Admin plataforma ────▶ │ web-admin    │ :3005 │     (REST + WebSocket)  └▶ Redis 7
  Portero ─── app móvil (Expo) ─────────────────┘           ▲
                                     Stripe / Redsys ─ webhooks
```

| Carpeta | Qué es |
|---|---|
| `apps/api` | API NestJS: auth, eventos, motor de reserva, pagos, emisión, facturación, outbox |
| `apps/web-compra` | Tienda pública y módulos incrustables |
| `apps/web-gestion` | Consola del promotor |
| `apps/web-taquilla` | Punto de venta presencial |
| `apps/web-admin` | Administración de la plataforma |
| `acceso-movil` | App de control de acceso (Expo, fuera de los workspaces de npm) |
| `packages/database` | Esquema Drizzle, migraciones SQL y políticas RLS |
| `packages/crypto` | Firma y verificación de QR (compartido entre API y app) |
| `packages/types` | Tipos compartidos |

**Cómo funciona una compra**: el comprador elige plazas → la API crea una reserva de 10 min
(un índice único en Postgres hace imposible vender dos veces la misma plaza) → paga en la
pasarela → el webhook confirma el pedido → un *worker* (tabla `outbox`) emite las entradas
con QR firmado, la factura y el email. Si el proceso se cae a mitad, el `outbox` lo retoma.

---

## Desarrollo local

Requisitos: **Node 22** (mínimo 20), **npm 11**, **Docker**.

```bash
npm install
cp .env.example .env
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env   # o rellena la línea vacía
for a in web-compra web-gestion web-taquilla web-admin; do
  echo "NEXT_PUBLIC_API_URL=http://localhost:3000" > apps/$a/.env.local
done

npm run infra:up                                        # Postgres + Redis
npm run build -w @ticketing/database -w @ticketing/crypto -w @ticketing/types
(set -a; . ./.env; set +a; npm run db:migrate)          # migraciones
psql postgres://postgres:postgres@localhost:5432/ticketing -f scripts/dev-app-user-login.sql
npm run build -w @ticketing/api && node --env-file=.env apps/api/dist/seed.js   # datos demo

npm run dev   # API :3000 · compra :3001 · gestión :3002 · taquilla :3004 · admin :3005
```

- Con `PAYMENTS_PROVIDER=fake` se puede comprar sin cuenta en ninguna pasarela.
- Los emails no se envían: se guardan en `dev-outbox/`.
- Usuarios demo del seed: promotor `admin@demo.test` / `demo1234` (tienda en
  `http://localhost:3001/demo`), taquilla `taquillero@demo.test` / `taquillero123`,
  portero `portero@demo.test` / `portero123`, plataforma `root@platform.test` / `root1234`.
- App de acceso: `cd acceso-movil && npm install && npx expo start` (con Expo Go; la URL de
  la API se deduce de la IP del ordenador o se fuerza con `EXPO_PUBLIC_API_URL`).
- Comprobaciones: `npm run typecheck` y `npm run test:rls` (aislamiento entre promotores).
  La CI de GitHub (`.github/workflows/ci.yml`) ejecuta ambas en cada push.

---

## Variables de entorno

La API lee el fichero `.env` de la **raíz del repositorio** al arrancar (o las variables del
entorno, si no existe). **Nunca se versiona** (está en `.gitignore`).

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | sí | `production` en un servidor. Con ese valor la API no arranca sin `JWT_SECRET` propio |
| `DATABASE_URL` | sí | Conexión **superusuario** (migraciones, seed y tareas privilegiadas) |
| `DATABASE_URL_APP` | sí | Conexión con el rol `app_user` (sin `BYPASSRLS`); la usa la API para todo lo del promotor |
| `REDIS_URL` | sí | `redis://localhost:6379` |
| `JWT_SECRET` | sí | Firma de sesiones. `openssl rand -base64 48` |
| `MASTER_KEY` | sí | 32 bytes en base64 (`openssl rand -base64 32`). Cifra las claves de los QR. **Si se pierde, los QR emitidos dejan de validar** |
| `PORT` | no | Puerto de la API (3000) |
| `PUBLIC_API_URL` | en servidor | URL pública de la API (`https://api.tudominio.com`): imágenes y notificaciones de Redsys |
| `SHOP_PUBLIC_URL` | en servidor | URL pública de la tienda: vuelta del comprador desde Redsys |
| `WEB_ORIGIN` | en servidor | Orígenes permitidos (CORS y WebSocket), separados por comas: las cuatro webs |
| `TRUST_PROXY` | en servidor | `1` detrás de Caddy/Nginx (para leer la IP real en los límites de peticiones) |
| `UPLOADS_DIR` | no | Carpeta de imágenes subidas (por defecto `uploads/` en la raíz) |
| `DEV_MAIL_DIR` | no | Carpeta donde se escriben los emails (por defecto `dev-outbox/`) |
| `PAYMENTS_PROVIDER` | sí | Pasarela de tarjeta: `stripe`, `redsys` o `fake` (solo pruebas) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | con Stripe | Claves de Stripe |
| `REDSYS_MERCHANT_CODE`, `REDSYS_TERMINAL`, `REDSYS_SECRET`, `REDSYS_ENV`, `REDSYS_BIZUM` | con Redsys/Bizum | Datos del TPV virtual; `REDSYS_ENV=test` o `live`; `REDSYS_BIZUM=1` activa Bizum |
| `HOLD_TTL_MINUTES` | no | Duración de la reserva temporal (10) |
| `CURRENCY` | no | Moneda (`EUR`) |
| `POSTGRES_PASSWORD` | en servidor | Contraseña del superusuario de Postgres que crea Docker Compose |

Las webs Next.js necesitan, **en el momento de compilar**, un `.env.production` (o
`.env.local`) en su carpeta:

| Web | Variables |
|---|---|
| `apps/web-compra`, `apps/web-taquilla`, `apps/web-admin` | `NEXT_PUBLIC_API_URL` |
| `apps/web-gestion` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SHOP_URL` (URL de la tienda, para los enlaces e «Integrar en tu web») |

> Las variables `NEXT_PUBLIC_*` quedan incrustadas en el JavaScript al compilar: si cambian,
> hay que volver a hacer `npm run build`.

---

## Despliegue en un servidor

Guía para instalar la plataforma completa en **un solo VPS** (pruebas o primera producción)
con Ubuntu 24.04. Todo corre en la misma máquina: Postgres y Redis en Docker, la API y las
webs con Node gestionadas por PM2, y **Caddy** delante con HTTPS automático.

### 0. Requisitos

- VPS con Ubuntu 24.04, **mínimo 2 vCPU y 4 GB de RAM** (compilar las cuatro webs Next.js
  consume memoria; con 2 GB añade swap, ver paso 1). 40 GB de disco.
- Un dominio. Crea estos registros **DNS tipo A** apuntando a la IP del VPS
  (los nombres son un ejemplo; usa los que quieras):

  | Subdominio | Servicio |
  |---|---|
  | `api.tudominio.com` | API |
  | `entradas.tudominio.com` | Tienda (`web-compra`) |
  | `gestion.tudominio.com` | Consola del promotor |
  | `taquilla.tudominio.com` | Taquilla |
  | `admin.tudominio.com` | Admin de plataforma |

  En un servidor de pruebas, protege las webs internas o evita que se indexen.

### 1. Preparar el servidor

Entra como root y crea un usuario sin privilegios para la aplicación:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw fail2ban unattended-upgrades postgresql-client
adduser --disabled-password --gecos "" ticketing
usermod -aG sudo ticketing
# Copia tu clave SSH al nuevo usuario
mkdir -p /home/ticketing/.ssh && cp ~/.ssh/authorized_keys /home/ticketing/.ssh/
chown -R ticketing:ticketing /home/ticketing/.ssh && chmod 700 /home/ticketing/.ssh
```

Endurece SSH (`/etc/ssh/sshd_config`: `PasswordAuthentication no` y `PermitRootLogin no`;
después `systemctl restart ssh`) **solo tras comprobar que entras como `ticketing` con tu
clave**.

Cortafuegos (solo SSH y web):

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

Actualizaciones de seguridad automáticas: `dpkg-reconfigure -plow unattended-upgrades`.

Si el VPS tiene menos de 4 GB, añade swap:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 2. Instalar Docker, Node y Caddy

```bash
# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker ticketing

# Node 22 + PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g npm@11 pm2

# Caddy (proxy inverso con certificados HTTPS automáticos)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

A partir de aquí, trabaja como el usuario `ticketing` (`su - ticketing`).

### 3. Descargar el código desde GitHub (repositorio privado)

Usa una **deploy key** de solo lectura: da acceso a este repositorio y a nada más de tu cuenta.

```bash
ssh-keygen -t ed25519 -C "vps-ticketing" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

En GitHub: repositorio → **Settings → Deploy keys → Add deploy key**, pega la clave pública
y **deja sin marcar** «Allow write access». Después:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:Rocollxyz/ticketing-saas.git ~/ticketing-saas
cd ~/ticketing-saas
```

### 4. Crear el `.env` de producción

Genera los secretos (cada uno distinto):

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # MASTER_KEY
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -hex 24      # contraseña de app_user
```

Crea `~/ticketing-saas/.env` (sustituye los valores entre `<…>` y el dominio):

```dotenv
NODE_ENV=production

POSTGRES_PASSWORD=<postgres_password>
DATABASE_URL=postgres://postgres:<postgres_password>@localhost:5432/ticketing
DATABASE_URL_APP=postgres://app_user:<app_user_password>@localhost:5432/ticketing
REDIS_URL=redis://localhost:6379

JWT_SECRET=<jwt_secret>
MASTER_KEY=<master_key>

PORT=3000
PUBLIC_API_URL=https://api.tudominio.com
SHOP_PUBLIC_URL=https://entradas.tudominio.com
WEB_ORIGIN=https://entradas.tudominio.com,https://gestion.tudominio.com,https://taquilla.tudominio.com,https://admin.tudominio.com
TRUST_PROXY=1

# Pagos: en un servidor de pruebas, Stripe en modo test o Redsys de pruebas.
PAYMENTS_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
# REDSYS_MERCHANT_CODE=…
# REDSYS_TERMINAL=1
# REDSYS_SECRET=…
# REDSYS_ENV=test
# REDSYS_BIZUM=1
```

```bash
chmod 600 .env
```

> **Guarda `MASTER_KEY` y `JWT_SECRET` fuera del servidor** (gestor de contraseñas). Sin la
> `MASTER_KEY`, los QR ya emitidos no se pueden validar.

Variables de las webs (se leen al compilar):

```bash
for a in web-compra web-taquilla web-admin; do
  echo "NEXT_PUBLIC_API_URL=https://api.tudominio.com" > apps/$a/.env.production
done
printf "NEXT_PUBLIC_API_URL=https://api.tudominio.com\nNEXT_PUBLIC_SHOP_URL=https://entradas.tudominio.com\n" \
  > apps/web-gestion/.env.production
```

### 5. Arrancar Postgres y Redis

```bash
docker compose up -d
docker compose ps        # ambos deben salir «healthy»
```

El `docker-compose.yml` solo publica los puertos en `127.0.0.1`: Postgres y Redis no son
accesibles desde internet (importante, porque Docker se salta las reglas de `ufw`).

### 6. Instalar, compilar y migrar

```bash
npm ci
npm run build                                   # API, paquetes y las cuatro webs
(set -a; . ./.env; set +a; npm run db:migrate)  # crea las tablas, RLS y el rol app_user
```

Da login al rol `app_user` con **su contraseña de producción** (la misma que pusiste en
`DATABASE_URL_APP`; no uses `scripts/dev-app-user-login.sql`, que es solo para desarrollo):

```bash
(set -a; . ./.env; set +a; psql "$DATABASE_URL" -c "ALTER ROLE app_user LOGIN PASSWORD '<app_user_password>';")
```

### 7. Crear los usuarios iniciales

Hoy el seed es la única forma de crear el **admin de plataforma**. Crea también un promotor
de demostración con taquillero y portero:

```bash
node --env-file=.env apps/api/dist/seed.js
```

Las contraseñas del seed son públicas (están en el código), así que **cámbialas en el
momento**. Para cada usuario (`root@platform.test`, `admin@demo.test`,
`taquillero@demo.test`, `portero@demo.test`):

```bash
read -s -p "Nueva contraseña: " PW; echo
HASH=$(node -e 'console.log(require("bcryptjs").hashSync(process.argv[1], 10))' "$PW")
(set -a; . ./.env; set +a; psql "$DATABASE_URL" -v h="$HASH" -v e="root@platform.test" \
  <<< "UPDATE \"user\" SET password_hash = :'h' WHERE email = :'e';")
unset PW HASH
```

(Ejecútalo desde `~/ticketing-saas`; `psql` solo sustituye las variables `:'h'` leyendo el SQL
por la entrada estándar, no con `-c`.) Después, en
el admin de plataforma (`https://admin.tudominio.com`) se dan de alta los promotores reales,
cada uno con su usuario y contraseña.

### 8. Arrancar con PM2

Crea `~/ticketing-saas/ecosystem.config.cjs` (no contiene secretos: la API lee el `.env`):

```js
module.exports = {
  apps: [
    { name: "api",          cwd: "apps/api",          script: "dist/main.js", node_args: "--env-file=../../.env" },
    { name: "web-compra",   cwd: "apps/web-compra",   script: "npm", args: "start" },
    { name: "web-gestion",  cwd: "apps/web-gestion",  script: "npm", args: "start" },
    { name: "web-taquilla", cwd: "apps/web-taquilla", script: "npm", args: "start" },
    { name: "web-admin",    cwd: "apps/web-admin",    script: "npm", args: "start" },
  ],
};
```

> **La API debe correr en una sola instancia** (sin `instances`/modo cluster): el *worker*
> del `outbox` y el barrido de reservas caducadas viven dentro de la API y, con dos copias,
> se enviarían emails duplicados.

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u ticketing --hp /home/ticketing   # ejecuta la línea que imprima (con sudo)
pm2 status
curl -s localhost:3000/health                           # debe responder OK
```

Logs: `pm2 logs api` (o el nombre de cada web). Rotación de logs: `pm2 install pm2-logrotate`.

### 9. Configurar Caddy (HTTPS)

Edita `/etc/caddy/Caddyfile` (con `sudo`):

```caddyfile
{
	email tu-email@tudominio.com
}

api.tudominio.com {
	encode gzip
	request_body {
		max_size 20MB
	}
	reverse_proxy localhost:3000
}

entradas.tudominio.com {
	encode gzip
	reverse_proxy localhost:3001
}

gestion.tudominio.com {
	encode gzip
	reverse_proxy localhost:3002
}

taquilla.tudominio.com {
	encode gzip
	reverse_proxy localhost:3004
}

admin.tudominio.com {
	encode gzip
	reverse_proxy localhost:3005
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtiene y renueva solo los certificados de Let's Encrypt y reenvía el WebSocket del
plano en tiempo real sin configuración extra. Comprueba `https://api.tudominio.com/health`.

Opcional en pruebas: protege `gestion`, `taquilla` y `admin` con contraseña básica de Caddy
(`basic_auth`, la contraseña se genera con `caddy hash-password`) o limita por IP
(`@fuera not remote_ip <tu-ip>` + `respond @fuera 403`).

### 10. Configurar las pasarelas de pago

**Stripe** (Dashboard → Developers → Webhooks → Add endpoint):
- URL: `https://api.tudominio.com/webhooks/stripe`
- Eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.failed`,
  `charge.refund.updated`.
- Copia el *signing secret* (`whsec_…`) en `STRIPE_WEBHOOK_SECRET` y reinicia: `pm2 restart api`.
- Para Apple Pay, verifica el dominio de la tienda en Stripe (Settings → Payment methods →
  Apple Pay).

**Redsys / Bizum**:
- La notificación llega a `https://api.tudominio.com/webhooks/redsys` (se construye con
  `PUBLIC_API_URL`; no hay que darla de alta en el banco).
- En pruebas, `REDSYS_ENV=test` con los datos genéricos de Redsys (ver `.env.example`); en
  producción, los del contrato del TPV virtual con el banco y `REDSYS_ENV=live`.

### 11. App de acceso (porteros)

La app apunta a la API con `EXPO_PUBLIC_API_URL`:

```bash
cd acceso-movil && npm install
EXPO_PUBLIC_API_URL=https://api.tudominio.com npx expo start
```

Para pruebas basta Expo Go. Para producción hay que generar la app con Expo Dev Client / EAS
(cámara y modo sin conexión).

### 12. Comprobación final

1. `https://admin.tudominio.com` → entra con el admin de plataforma y crea un promotor.
2. `https://gestion.tudominio.com` → entra como el promotor, crea un evento y ponlo a la venta.
3. `https://entradas.tudominio.com/<slug-del-promotor>` → compra con la tarjeta de prueba de
   Stripe `4242 4242 4242 4242` (cualquier fecha futura y CVC).
4. En la consola, «Asistentes» → la entrada aparece emitida.
5. Escanea el QR con la app de acceso.

---

## Actualizar una instalación

```bash
cd ~/ticketing-saas
git pull
npm ci
npm run build
(set -a; . ./.env; set +a; npm run db:migrate)
pm2 restart all
```

Haz una copia de la base de datos **antes** de cada actualización que traiga migraciones.

---

## Copias de seguridad

Lo que hay que copiar: la **base de datos**, la carpeta **`uploads/`** (imágenes), el **`.env`**
(sobre todo `MASTER_KEY`) y, mientras los emails se escriban en disco, `dev-outbox/`.

Copia diaria de la base de datos (crontab de `ticketing`, `crontab -e`):

```cron
0 3 * * * cd ~/ticketing-saas && mkdir -p ~/backups && docker compose exec -T postgres pg_dump -U postgres -Fc ticketing > ~/backups/ticketing-$(date +\%F).dump && find ~/backups -name '*.dump' -mtime +14 -delete
```

Lleva las copias **fuera del VPS** (otro servidor, almacenamiento S3/R2, cifradas con
`age` o `gpg`). Restaurar:

```bash
docker compose exec -T postgres pg_restore -U postgres -d ticketing --clean --if-exists < ~/backups/ticketing-AAAA-MM-DD.dump
```

**Prueba a restaurar una copia cada mes** (ver [OPERACIONES.md](OPERACIONES.md)).

---

## Limitaciones conocidas antes de producción

Detalle y estado en [PENDIENTES.md](PENDIENTES.md). Las más importantes para un servidor:

- **Los emails no se envían**: solo existe el proveedor que los escribe en disco
  (`dev-outbox/`). En un servidor el comprador no recibe la entrada por email hasta que se
  haga el servicio propio de correo; mientras tanto se puede reenviar o descargar desde la
  consola.
- **Usuarios iniciales**: el admin de plataforma solo se crea con el seed y no hay «cambiar
  contraseña» en las consolas (se hace a mano, paso 7).
- **Una sola instancia de la API** (tareas de fondo dentro del mismo proceso).
- **Imágenes en disco local**: falta el adaptador S3/R2.
- **No hay Dockerfiles** para la API y las webs: se despliegan con Node + PM2.
- **Redsys en producción** necesita el contrato del TPV virtual con el banco.
- **VERI\*FACTU**: falta el envío a la AEAT (obligatorio en 2027, ver
  [FACTURACION.md](FACTURACION.md)).
- `/embed/*` se puede incrustar en cualquier web (falta limitarlo por promotor).
- Antes de abrir al público: Cloudflare delante, captcha en reservar/pagar/login y el resto
  del plan contra bots y de defensa de [PENDIENTES.md](PENDIENTES.md) y
  [OPERACIONES.md](OPERACIONES.md).

---

© 2026 Rocollxyz. Todos los derechos reservados. El código es visible públicamente, pero
no se concede ninguna licencia de uso, copia, modificación ni distribución sin permiso
expreso del autor.
