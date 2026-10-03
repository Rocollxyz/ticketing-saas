# Plataforma de Ticketing SaaS — Arquitectura

> Documento vivo. Define la visión, el modelo de datos, los flujos críticos y el
> roadmap. Se actualiza a medida que evoluciona el proyecto.

## 1. Visión

SaaS multi-tenant de venta y control de entradas, alojado en VPS propios. Cada
promotor accede a su espacio aislado, crea sus eventos/ventas y opera de forma
independiente. La plataforma cubre venta online, venta física en taquilla,
control de acceso en puerta y gestión de la entrada por parte del comprador.

**Decisiones de base ya tomadas:**

- Stack propio (no WordPress/FooEvents). FooEvents queda solo como referencia de
  enfoques: estructura del objeto *ticket*, payload de QR y flujo de check-in.
- Pagos: **Stripe primero** (modo test cómodo), **Redsys después**, y **TPV
  físico** para taquilla — todos detrás de una capa de pagos abstracta.
- App móvil con **Expo / React Native** (Expo Go solo en desarrollo; producción
  con Expo Dev Client + EAS por necesitar cámara y modo offline). De momento solo
  la **app de acceso**; la app de comprador se pospone (ver §10).
- Despliegue: código contenerizado desde el día 1; orquestación se decide por fase.
- Seguridad y estabilidad como eje transversal, no como tarea final.

## 2. Superficies (5 clientes, 1 API)

| # | Cliente            | Usuario             | Función clave                                                  | Tecnología        |
|---|--------------------|---------------------|---------------------------------------------------------------|-------------------|
| 1 | Web de compra      | Comprador online    | Catálogo, seating map, timer 10 min, pago Stripe              | Next.js/React     |
| 2 | App de acceso      | Personal de puerta  | Escanea/valida QR, marca uso, tolerante a offline             | Expo / RN         |
| 3 | POS de taquilla    | Vendedor físico     | Selección de asiento, cobro con TPV, impresión inmediata      | Next.js/React     |
| 4 | Backend promotor   | Organizador         | Eventos, mapas, precios, analytics en su espacio aislado     | Next.js/React     |
| 5 | Admin del SaaS     | Operador plataforma | Alta de promotores, facturación, monitorización              | Next.js/React     |

> **Pospuesto:** *App de comprador* (entradas en el móvil + QR dinámico). Añade
> complejidad (QR rotativo, validación de drift offline, wallet) que no es
> necesaria para operar. Hasta entonces, la entrega de la entrada es por
> email/PDF + Wallet (ver §6). Detalle en §10.

Todas consumen el mismo **API multi-tenant** (NestJS, TypeScript).

## 3. Stack propuesto

- **Backend/API**: NestJS (TypeScript), modular, capa de pagos por adaptadores.
- **DB**: PostgreSQL (aislamiento por `tenant_id` reforzado con **Row Level
  Security**) + **Redis** (timers de hold, expiración, pub/sub de estado de
  asientos en tiempo real).
- **Frontends web**: Next.js / React. Seating map en Canvas/SVG.
- **App móvil**: Expo / React Native (acceso). Comprador pospuesto (§10).
- **Pagos**: interfaz `PaymentProvider` → `StripeProvider` (fase 2),
  `RedsysProvider` y `TpvProvider` (después).
- **QR**: tokens firmados (HMAC/JWT), clave por evento, validables offline.
- **Tiempo real**: WebSocket para empujar el estado del mapa de asientos.
- **Repos**: monorepo **Turborepo** (`apps/` + `packages/`), todo TypeScript (§9).
- **ORM**: **Drizzle** (SQL-first, compatible con RLS + `SET LOCAL`) (§9).
- **Despliegue**: contenedores con **Docker Compose** sobre VPS propios + proxy
  con TLS automático; K8s solo si el negocio lo exige (§9).

## 4. Motor de reserva (núcleo del sistema)

Es la pieza más difícil y crítica. Compartida por web compra y POS.

```
Usuario elige asiento(s)
  → Backend crea un HOLD (reserva temporal) con expiración 10 min
  → Asiento queda HELD: nadie más lo ve disponible (estado en tiempo real)
  → Si paga   → HOLD pasa a CONFIRMED (pago ok) → ISSUED (entrada + QR firmado)
  → Si expira → HOLD se libera automáticamente → asiento vuelve a AVAILABLE
```

- **Anti-sobreventa**: transacción Postgres + lock por asiento; Redis controla la
  expiración y publica cambios de estado por WebSocket.
- **En POS**: el timer se relaja o desaparece (cobro en mano e inmediato).
- **Idempotencia** (cómo, no solo qué):
  - **En la pasarela**: enviar una `Idempotency-Key` derivada del `hold_id` al
    crear el pago. Doble clic o reintento de red → la pasarela nunca cobra dos veces.
  - **En el webhook entrante**: dedupe por `event_id` del proveedor (tabla de
    eventos procesados) + transacción Postgres que comprueba el estado; si ya está
    `CONFIRMED`/`ISSUED`, responder `200 OK` sin re-emitir.
- **Concurrencia bajo drop**: el cuello de botella real no es la API (escala
  horizontal fácil) sino la **contención sobre el asiento** (lock por fila) y
  Postgres. Se mitiga con cola de espera + Redis, no solo con más réplicas.

### Ciclo de vida del ticket / asiento

```
AVAILABLE → HELD → CONFIRMED → ISSUED → CHECKED_IN
                 ↘ (expira/cancela) → AVAILABLE
```

Dos estados distintos a propósito:
- **CONFIRMED**: el pago se ha completado/capturado. Es el punto de verdad financiero.
- **ISSUED**: se ha materializado la entrada (PDF/Wallet + QR firmado) y se ha
  entregado al comprador. La separación permite reintentar la emisión sin re-cobrar
  y es donde actúa la idempotencia de webhooks.

## 5. Modelo de datos

Plano de las tablas de PostgreSQL. Diseñado con la seguridad y la estabilidad como
criterio, no como capa posterior. **Principios transversales** (aplican a todas las
tablas salvo que se diga lo contrario):

- **PK `UUID` (v7)**: no secuencial → no se pueden enumerar entradas/eventos
  adivinando IDs. v7 conserva orden temporal para índices sin filtrar conteos.
- **`tenant_id` en toda tabla de negocio** + política **RLS** (§7). Es la columna
  de aislamiento; nunca se confía solo en el `WHERE` de la aplicación.
- **FKs compuestas con `tenant_id`** (p.ej. `FOREIGN KEY (tenant_id, event_id)`):
  hace **imposible por esquema** que una fila referencie datos de otro tenant.
- **Estados como `enum` de Postgres**, no texto libre → transiciones válidas
  garantizadas por la base de datos.
- **Dinero como `bigint` en céntimos + `currency`**; nunca `float` (evita errores
  de redondeo en cobros).
- **Auditoría**: `created_at`, `updated_at`; borrado **lógico** (`deleted_at`) en
  entidades con valor histórico/fiscal (nunca `DELETE` físico de una entrada).
- **Bloqueo optimista**: columna `version` en las entidades del motor de reserva.

### Entidades núcleo

**Identidad y tenancy**
- `tenant` — promotor. Raíz del aislamiento. (No lleva `tenant_id`; *es* el tenant.)
- `user` — persona. Email único global; credenciales con hash (Argon2/bcrypt).
- `membership` — relación `user`↔`tenant` con **rol** (`promotor`, `taquillero`,
  `portero`, `admin_saas`). Un user puede operar en varios tenants con distinto rol.
  Modelar el rol aquí (y no en `user`) evita escalada de privilegios entre tenants.

**Catálogo del evento**
- `event` — `tenant_id`, nombre, fechas, estado (`DRAFT`/`ON_SALE`/`CLOSED`), `venue_id`.
- `venue` / `seating_map` — recinto y su mapa (geometría en JSON validado).
- `zone` — sector del mapa (general, grada, pista…).
- `seat` — `tenant_id`, `event_id`, `zone_id`, fila, número.
  - **Unicidad**: `UNIQUE (event_id, zone_id, fila, numero)`.
  - El **estado en vivo** (AVAILABLE/HELD…) **no se guarda aquí**: se deriva de
    holds/tickets activos (fuente única de verdad) y se cachea en Redis para el
    tiempo real. Evita estados contradictorios entre dos columnas.
- `ticket_type` — tipo de entrada (general, VIP, reducida) y reglas.
- `price` — `ticket_type_id` × tramo/fecha → importe en céntimos.

**Motor de reserva** (el núcleo, §4)
- `hold` — `tenant_id`, `event_id`, `session_id`, `expires_at`, estado
  (`ACTIVE`/`CONFIRMED`/`EXPIRED`/`RELEASED`), `version`.
- `hold_seat` — join `hold`↔`seat`.
  - **Anti-sobreventa por esquema**: índice **único parcial** que impide dos holds
    *activos* o un ticket emitido sobre el mismo asiento:
    `UNIQUE (event_id, seat_id) WHERE estado IN ('ACTIVE','CONFIRMED')`. La base de
    datos rechaza la doble reserva aunque la aplicación falle.
- `order` — agrupa la compra. Nace con el hold (estado `PENDING`), pasa a `PAID`.
- `payment` — `order_id`, proveedor (`stripe`/`redsys`/`tpv`), `provider_ref`,
  importe, estado. **Nunca** datos de tarjeta (solo token/ref → PCI-DSS SAQ-A).
- `ticket` — la entrada emitida. `tenant_id`, `event_id`, `seat_id`, `order_id`,
  estado (`ISSUED`/`CHECKED_IN`/`VOID`), `qr_key_id`. QR firmado, no guardado en claro.

**Acceso y control**
- `check_in` — registro **append-only** de cada validación: `ticket_id`, `device_id`,
  timestamp, resultado (`OK`/`DUPLICATE`/`INVALID`). Append-only = pista forense y
  detección de reentradas; nunca se actualiza ni borra.
- `event_signing_key` — clave de firma de QR **por evento** (cifrada en reposo),
  con `rotated_at` para rotación. Permite validación offline en la app de acceso.

**Robustez de pagos e infraestructura**
- `processed_webhook_event` — `provider`, `event_id` (UNIQUE), procesado_at. Es la
  tabla de **idempotencia** de §4: un webhook reintentado se detecta y se ignora.
- `audit_log` — append-only de acciones sensibles (cambios de precio, reembolsos,
  altas de personal), con `actor_user_id`, `tenant_id`, acción y diff. Para GDPR y
  trazabilidad.
- `outbox` (opcional, recomendado) — patrón *transactional outbox*: los efectos
  externos (emitir ticket, enviar email) se escriben en la misma transacción que el
  cambio de estado y un worker los procesa. Evita "cobrado pero sin entrada" si el
  proceso muere a mitad.

### Relaciones (resumen)

```
tenant 1─* event *─1 venue 1─* zone 1─* seat
event 1─* ticket_type 1─* price
hold *─* seat (vía hold_seat)        order 1─* ticket
hold 1─1 order 1─* payment           ticket 1─* check_in
event 1─* event_signing_key
```

### Notas de estabilidad

- Todas las transiciones del ciclo de vida (§4) ocurren **dentro de una transacción**
  con `SELECT ... FOR UPDATE` sobre el asiento → sin sobreventa bajo concurrencia.
- Índices pensados para las consultas calientes: `(event_id, estado)` en `seat`
  derivado, `expires_at` en `hold` (barrido de expiración), `(tenant_id, event_id)`
  generalizado para que RLS no degrade.
- Migraciones versionadas y reversibles (drizzle-kit), nunca destructivas en caliente.

## 6. Entrega y gestión de la entrada

**Canal actual — email + Wallet:**
- PDF + enlace a Apple/Google Wallet. QR firmado de un solo uso, controlado en
  check-in por la app de acceso (valida la firma offline con la clave del evento).

**Pospuesto — QR dinámico (depende de la app de comprador, §10):**
- QR **rotativo** (token firmado de vida corta, tipo TOTP) para evitar fraude por
  captura de pantalla y reventa. Implica resolver el *drift* de reloj en la app de
  acceso offline (ventana de tolerancia ± N pasos). Se aborda junto con la app de
  comprador; no es requisito para operar con el QR estático de un solo uso.

## 7. Seguridad y estabilidad (transversal)

**Aplicación**
- Aislamiento multi-tenant estricto: defensa en profundidad en **código y base de
  datos**, no solo en el `WHERE` de la aplicación. Tests automáticos anti-fuga.
- RBAC por roles: comprador, promotor, taquillero, portero, admin.
- QR firmados (HMAC/JWT), claves por evento, rotación de secretos.
- Pagos: nunca tocamos datos de tarjeta → alcance PCI-DSS mínimo (SAQ-A).
- Anti-fraude/anti-bot en drops: rate limiting, captcha/cola, un hold por sesión.

**Aislamiento por `tenant_id` + Row Level Security (RLS)** — decidido (§9)
- El guardián de auth de NestJS extrae el `tenant_id` del JWT y lo inyecta por
  conexión: `SET LOCAL app.current_tenant_id = '<id>'` dentro de la transacción.
- Política por tabla crítica, p.ej.:
  `CREATE POLICY tenant_isolation ON tickets FOR ALL USING (tenant_id = current_setting('app.current_tenant_id'))`.
  Así, aunque se escape un `SELECT * FROM tickets`, Postgres filtra por tenant.
- **Cuidado en la implementación** (donde esto se rompe en la práctica):
  - Usar `FORCE ROW LEVEL SECURITY` y un **rol de aplicación sin BYPASSRLS** (el
    owner ignora RLS por defecto → parecería funcionar y no filtraría nada).
  - `SET LOCAL` exige transacción por request; con pooler (PgBouncer en *transaction
    mode*) hay que asegurar que no se reutiliza el `tenant_id` de otra conexión.
  - Medir el overhead de RLS en las queries calientes del motor de reserva (Fase 1).

**Datos personales (PII) y retención**
- Del comprador guardamos el mínimo: nombre, email y referencia de pago (token, nunca
  PAN). El teléfono solo si es necesario para el evento.
- Retención definida por tipo: entradas/justificantes según obligación fiscal;
  datos de marketing solo con consentimiento y con borrado a petición (derecho al
  olvido GDPR).
- PII cifrada en reposo; logs sin PII (o seudonimizada). Export/borrado por tenant.

**Infraestructura (VPS)**
- TLS en todo, secretos en gestor dedicado (no en `.env` versionado), firewall,
  fail2ban, backups cifrados y restauración probada.
- Cumplimiento GDPR (datos en UE).

**Operación**
- CI/CD con tests + análisis de seguridad obligatorios antes de desplegar.
- Despliegues sin downtime; migraciones de DB versionadas y reversibles.
- Observabilidad: logs centralizados, métricas, alertas, health checks
  (prioridad: motor de reserva).

## 8. Roadmap por fases

- **Fase 0 — Cimientos**: monorepo Turborepo, API base NestJS, Postgres (con RLS)
  +Redis, modelo de datos multi-tenant, auth/RBAC, Docker Compose + CI con tests y
  security checks.
- **Fase 1 — Motor de reserva + emisión**: holds, expiración, estados, emisión de
  ticket + QR firmado. (Núcleo, con tests de concurrencia.)
- **Fase 2 — Web de compra + Stripe**: catálogo, carrito con timer 10 min,
  `StripeProvider`, entrega por email/PDF/wallet.
- **Fase 3 — Seating map**: editor de mapas (promotor) + selección en tiempo real
  (comprador), WebSocket.
- **Fase 4 — App de acceso**: escaneo/validación QR, modo offline.
- **Fase 5 — POS de taquilla**: selección de asiento, `TpvProvider`, impresión.
- **Fase 6 — Redsys + Admin SaaS + facturación**.
- **(Pospuesto) — App de comprador + QR dinámico** (ver §10).

## 9. Decisiones de arquitectura

- **Aislamiento de tenant → `tenant_id` por fila + RLS.** Schema-por-tenant se
  descarta: escala mal en migraciones (× N promotores) y rompe analíticas
  cross-tenant del Admin SaaS. RLS aporta la red de seguridad ante el factor humano.
  Detalle e implementación en §7.
- **Orquestación → enfoque evolutivo.** Fases 0–5: **Docker Compose** sobre VPS
  propios (un VPS para Postgres+Redis con NVMe; uno o dos para API/frontends),
  desplegado con herramienta ligera (Kamal/Portainer/webhooks de CI) + proxy
  inverso con TLS automático (Caddy/Nginx). Kubernetes/gestionados solo se evalúan
  si un evento masivo lo justifica — y aun así, el límite del drop es Postgres y la
  contención de asiento, no las réplicas de la API (ver §4).
- **Repos → monorepo con Turborepo** (todo TypeScript). `apps/` (api, web-compra,
  app-acceso, pos-taquilla, dashboard-promotor, admin-saas) y `packages/`
  (`types`/DTOs compartidos, `crypto` para firmar/verificar QR entre API y app de
  acceso, `database` esquemas+migraciones, `ui`). Ventajas: tipado end-to-end y
  caché de CI por proyecto afectado. *Admin SaaS se mantiene como app separada del
  dashboard de promotor por su privilegio cross-tenant.*
- **ORM → Drizzle.** SQL-first y control directo de transacción/conexión, que es lo
  que necesita RLS: `db.transaction(tx => { tx.execute(sql\`SET LOCAL app.current_tenant_id = ...\`); ... })`.
  Tipado end-to-end (encaja con `packages/types`) y migraciones explícitas
  (drizzle-kit) sin "magia" que choque con las políticas. Se descarta Prisma por su
  fricción histórica con RLS bajo pooler; TypeORM por tipado/mantenimiento.

## 10. Pospuesto (complejidad a resolver más adelante)

**App de comprador (Expo / RN) + QR dinámico.** No es necesaria para operar: la
entrega por email/PDF + Wallet con QR estático de un solo uso cubre el caso completo.
Se retoma cuando el núcleo esté estable. Lo que habrá que resolver entonces:

- QR rotativo tipo TOTP (token firmado de vida corta) anti captura/reventa.
- *Drift* de reloj y ventana de tolerancia en la validación offline de la app de acceso.
- Integración con Apple/Google Wallet desde la app.
- Gestión de entradas en el móvil (listado, transferencia, reembolso).

El modelo de datos y la emisión de tickets (§4) deben dejarse preparados para
admitir tanto QR estático como dinámico sin migración disruptiva.
