# Auditoría de seguridad y correctness

> Registro de hallazgos. **Documento de seguimiento**: inicialmente se decidió NO
> corregir nada y revisitar cada punto en su fase. **2026-10-03: Categoría 2 cerrada
> entera** (A1, A1-bis, B2, C1 — migraciones 0006–0008). Cada
> entrada indica severidad, si es defecto real *hoy* o trabajo pendiente conocido,
> y la fase en que debe resolverse.
>
> Referencias `§N` apuntan a [ARCHITECTURE.md](ARCHITECTURE.md).

**Auditoría inicial: 2026-06-25** (tras cerrar Fase 0: esquema + RLS + API base).
Estado del código en ese momento: typecheck limpio; aislamiento RLS demostrado por
HTTP en las tablas con RLS.

---

## Cómo leer esto

- **Categoría 2 (acción cuando toque, antes de construir encima)**: decisiones de
  *esquema* ya migradas → baratas de cambiar ahora, caras con datos reales.
- **Categoría 1 (pendiente conocido)**: no son defectos; es trabajo planificado de
  Fase 1 / auth / CI que aún no se ha abordado.
- **Categoría 3 (anotar y olvidar)**: cosmético o de rendimiento, sin urgencia.

---

## Categoría 2 — Revisar antes de construir lógica encima (esquema congelado)

### A1 — `audit_log` y `outbox` llevan `tenant_id` pero NO tienen RLS ✅ RESUELTO (2026-10-03)
- **Corregido** en la migración `0006_rls_audit_outbox.sql`: ENABLE+FORCE RLS + política
  `tenant_isolation` en ambas; filas de sistema (`tenant_id` NULL) invisibles para
  `app_user`; además `REVOKE UPDATE, DELETE` a `app_user` (append-only desde la app; el
  worker marca `processed_at` vía AdminDb). Verificado como `app_user`: A solo ve lo suyo,
  sin contexto 0 filas, INSERT cruzado rechazado, UPDATE/DELETE denegados; venta POS →
  outbox → email entregado sigue funcionando.
- *Hallazgo original:*
- **Verificado en BD**: ambas tienen RLS desactivado y `app_user` tiene
  SELECT/INSERT/UPDATE/DELETE → un tenant puede leer/alterar la auditoría y la cola
  de efectos de otro. Es la **única fuga real existente hoy**.
- Contradice el propósito GDPR/forense de §5. La decisión de "fuera de RLS por
  diseño" fue incoherente para tablas que *sí* llevan `tenant_id`.
- **Posible corrección**: ENABLE+FORCE RLS + política `tenant_isolation` en ambas
  (cuidando filas de sistema con `tenant_id` NULL).

### A1-bis — `user` global sin RLS, `app_user` lee todos los `password_hash` ✅ RESUELTO (2026-10-03)
- **Decisión**: login (búsqueda global por email) y alta de usuarios son operaciones de
  auth/provisión previas al contexto de tenant y ya iban por AdminDb; la API bajo RLS no
  usa `user` en ningún sitio → migración `0008_user_no_app_access.sql`: `REVOKE ALL ON
  "user" FROM app_user`. Si algún día hace falta (p.ej. nombre del actor), vista acotada
  SIN `password_hash`, nunca devolver el GRANT. Verificado: `app_user` → permission
  denied; login de los 4 roles, alta de promotor y su login siguen funcionando.
- *Hallazgo original:*
- `app_user` puede enumerar email + hash de todos los usuarios de todos los tenants.
- **Matiz**: el login necesita búsqueda global por email, así que *algo* de acceso
  global es legítimo. Decisión a tomar: segregar PII, rol de solo-lectura acotado, o
  vista restringida. Documentar como decisión consciente, no como olvido.

### B2 — `ticket_seat_uq` es UNIQUE plano, sin filtrar por estado ✅ RESUELTO (2026-10-03)
- **Corregido** (migración `0007`): índice único parcial `WHERE status <> 'VOID'`.
  Verificado: con la entrada anulada se puede reemitir el asiento; una 2ª entrada viva
  sigue rechazada (23505).
- ⚠️ **Para el futuro flujo de reembolso/anulación**: anular el `ticket` NO basta para
  revender el asiento — su `hold_seat` sigue `CONFIRMED` y `hold_seat_active_uq` lo
  bloquea. Ese flujo debe pasar también el `hold_seat` (y el `hold`) a un estado
  no activo en la misma transacción.
- *Hallazgo original:*
- `UNIQUE (event_id, seat_id)` sin `WHERE`. Un ticket `VOID` (reembolso/cancelación)
  **bloquea para siempre** la reemisión de ese asiento.
- **Posible corrección**: índice único parcial `WHERE status <> 'VOID'`.

### C1 — Tablas raíz sin FK a `tenant` ✅ RESUELTO (2026-10-03)
- **Corregido** (migración `0007`): FK `tenant_id → tenant(id)` en las 14 tablas que no
  la tenían (incl. `audit_log`/`outbox`, donde NULL = fila de sistema sigue permitido).
- **Decisión de borrado: `ON DELETE RESTRICT`** (no cascade). Un promotor con eventos,
  pedidos o entradas no se puede borrar de un plumazo: son datos con valor fiscal/
  forense (§5). La baja de un promotor deberá ser un proceso explícito (desactivar,
  anonimizar PII, conservar lo fiscal). `membership`/`venue` mantienen su cascade previo.
  Verificado: insertar con `tenant_id` inexistente → FK violation; `DELETE tenant demo`
  → rechazado.
- *Hallazgo original:*
- `event`, `order`, `hold`, `ticket`, `payment`… tienen `tenant_id` pero sin FK a
  `tenant` (solo `membership` y `venue` la tienen, con cascade). Permite `tenant_id`
  huérfano y deja filas sueltas si se borra un tenant.
- **Posible corrección**: FK `tenant_id → tenant(id)` (decidir cascade) en raíz.

---

## Categoría 1 — Pendiente conocido (no son defectos; ya en el roadmap)

### A2 — No hay test automático anti-fuga ni CI ✅ RESUELTO (2026-10-04)
- **Corregido**: `packages/database/test/rls.test.mjs` (`npm run test:rls`) falla si una tabla
  con `tenant_id` no tiene RLS ENABLE+FORCE y política, si aparece una tabla sin `tenant_id`
  que no esté en la lista de globales, si `app_user` ve filas con un tenant inventado o sin
  tenant, o si puede escribir a nombre de otro tenant. Comprobado que detecta un FORCE
  quitado. CI en `.github/workflows/ci.yml` (tipos + este test sobre BD recién migrada);
  se activa al subir el repositorio.
- §7 exige "tests automáticos anti-fuga". El test A↔B fue manual y se borró.
- **Riesgo estructural**: RLS es opt-in por tabla; cualquier tabla con `tenant_id`
  añadida en una migración futura **nace sin RLS** (fuga silenciosa) y nada lo
  detecta. Conviene un test que falle si una tabla con `tenant_id` no tiene RLS.
- **Fase**: parte de "CI con tests y security checks" de Fase 0 aún no abordada.

### B1 — `hold_seat.status` duplicado de `hold.status` sin sincronización ✅ RESUELTO (Fase 1/3)
- Resuelto con "actualización forzada en la misma transacción": la liberación lazy
  (`releaseExpiredTx`), el sweeper y la confirmación actualizan `hold` y `hold_seat`
  juntos. (Revisado 2026-10-03.)
- *Hallazgo original:*
- El índice anti-sobreventa depende de `hold_seat.status`. Si un hold expira y solo
  se actualiza `hold.status`, el asiento queda bloqueado indefinidamente.
- **Fase 1 (motor de reserva)**: resolver con trigger, derivación, o actualización
  forzada en la misma transacción + barrido de expiración.

### B3 — Onboarding de tenant (chicken-and-egg) ✅ RESUELTO (Admin SaaS, 2026-06-25)
- ~~No se puede insertar un tenant sin su id ya en contexto (RLS).~~ Resuelto con el
  módulo `platform`: `POST /platform/tenants` (rol `admin_saas`, vía AdminDb privilegiada)
  crea tenant + usuario admin + membership en una transacción. Es el rol de provisión que
  faltaba. Verificado: tras el alta, el nuevo promotor puede autenticarse. El seed seguía
  usando la misma vía privilegiada para el tenant demo.

### C2 — Sin validación de entrada (DTOs/ValidationPipe) 🟡
- `POST /events` sin `name` → NULL en `NOT NULL` → 500. Body sin tipar.
- **Fase**: al cablear auth/JWT y endpoints reales.

### C3 — `x-tenant-id` es placeholder; sin validar UUID ni pertenencia 🟡
- Valor no-UUID llega al cast `::uuid` de la política → 500 en vez de 400.
- Al llegar el JWT: verificar que el usuario **pertenece** al tenant vía
  `membership`, no solo que el claim existe.
- **Fase**: auth (siguiente bloque).

### D1 — `enableShutdownHooks()` no se llama ✅ RESUELTO (Fase 2)
- `main.ts` ya llama a `app.enableShutdownHooks()`. (Revisado 2026-10-03.)
- *Hallazgo original:*
- `onModuleDestroy` no dispara en SIGINT → pool de Postgres no cierra limpio.
- **Fase**: endurecimiento pre-despliegue.

### D5 — Health check superficial ✅ RESUELTO (2026-10-04)
- `/health` comprueba Postgres (503 si cae → el balanceador saca la réplica) y Redis
  («degraded» con 200: la API sigue funcionando sin él).
- Devuelve `ok` sin comprobar Postgres/Redis.
- **Fase**: observabilidad / pre-despliegue.

---

## Addendum Fase 1 (motor de reserva) — 2026-06-25

### E1 — `event_signing_key.encrypted_key` se guarda EN CLARO ✅ RESUELTO (2026-10-04)
- **Corregido**: AES-256-GCM con `MASTER_KEY` (fuera de la BD; en prod, gestor de
  secretos). Las claves antiguas se cifran solas al arrancar. Si se pierde la MASTER_KEY, los
  QR emitidos dejan de validar. Sigue abierto G1 (la clave viaja descifrada al dispositivo).
- La columna se llama `encrypted_key` pero `getOrCreateEventKey` guarda la clave de
  firma de QR en base64 sin cifrar. Quien lea esa fila puede falsificar QR de ese
  evento.
- **Pendiente**: cifrado en reposo con una master key (KMS/secret manager) o
  `pgcrypto`. **Fase**: antes de producción / al endurecer emisión.

### E2 — `confirmAndIssue` emite sin pago real 🟢 (esperado)
- Crea `order` PAID y emite directamente. El pago con proveedor + webhook idempotente
  es **Fase 2**; documentado, no es defecto.

### E3 — Sin sweeper de fondo para holds expirados ✅ RESUELTO (Fase 3, 2026-06-25)
- ~~Solo hay lazy-release en `createHold` + endpoint manual.~~ Implementado
  `HoldSweeperService` (`@Interval` cada 20s) que libera holds expirados de TODOS
  los tenants vía AdminDb (trabajo de sistema, fuera de RLS a propósito) y emite
  `seats.released` para el tiempo real. Verificado: forzar `expires_at` al pasado →
  el sweeper marca EXPIRED y el asiento vuelve a estar disponible.

---

## Addendum Fase 3 (tiempo real + mapa de asientos) — 2026-06-25

### F1 — El gateway WebSocket NO autentica el `join` 🟢 (aceptable por diseño)
- Cualquier cliente puede unirse a `event:<eventId>` y recibir `seats.held/released/
  sold`. La disponibilidad de asientos ya es **información pública** (la expone el
  storefront), y los payloads solo llevan `seatId` + un `actor` (sessionId generado
  por el cliente, no sensible). Sin fuga de PII ni cross-tenant (eventId es UUID
  global). **Pendiente menor**: validar formato de `eventId` y rate-limit del `join`.

### F2 — `HoldSweeperService` usa AdminDb (fuera de RLS) 🟢 (esperado)
- El barrido es trabajo de sistema multi-tenant: necesita ver/actualizar holds de
  todos los tenants, por eso va por la conexión privilegiada. Superficie acotada (solo
  UPDATE de holds/hold_seat expirados). Coherente con el patrón de AdminDb (auth/seed).

### F3 — Editor de mapa: `PUT seatmap` exige rol `promotor` y valida pertenencia 🟢
- Comprueba `role === 'promotor'`, que cada `seatId` pertenece al evento y que la
  categoría asignada es del propio evento. RLS sigue siendo la barrera de tenant.

## Addendum Fase 4 (app de acceso) — 2026-06-25

### G1 — `GET /access/manifest` entrega la clave de firma al dispositivo 🟠
- Para validar offline, el manifest incluye la `event_signing_key`. Sumado a E1 (la
  clave se guarda en claro), un dispositivo comprometido podría falsificar QRs de ese
  evento. **Mitigación futura**: cifrado en reposo (E1) + rotación por evento + clave
  derivada/efímera por dispositivo, y caducidad del manifest.

### G2 — El grant OFFLINE es provisional (confía en el manifest) 🟢 (por diseño)
- Offline se concede el acceso si la entrada está en el manifest, no anulada y no
  escaneada localmente; la verificación de firma AUTORITATIVA y la resolución de
  conflictos las hace el servidor en `/access/sync`. Es el patrón habitual de control
  de acceso offline; el riesgo (doble entrada entre dispositivos sin red) se detecta al
  sincronizar, no se previene en la puerta.

### G3 — Anti-doble-entrada online: sólida ✅
- Transición atómica `ISSUED→CHECKED_IN` (UPDATE condicional) + `check_in` append-only.
  Probado con escaneo concurrente: exactamente 1 OK, resto DUPLICATE. Mismo patrón que
  la anti-sobreventa.

## Addendum gestión de eventos — 2026-10-03

### H1 — Reserva de un asiento de OTRO evento eludía la anti-sobreventa ✅ RESUELTO
- `createHold(eventId, seatIds)` no comprobaba que los asientos fueran del evento ni que
  éste estuviera a la venta. `hold_seat_active_uq` indexa `(event_id, seat_id)`, así que
  reservar el asiento X del evento A "a través" del evento B creaba una fila que NO
  bloqueaba X en A → doble venta posible con una petición manipulada.
- **Corregido en dos capas**: (1) esquema (migración `0009`): FKs compuestas
  `hold_seat/ticket (tenant_id, event_id, seat_id) → seat (tenant_id, event_id, id)` y
  `seat (tenant_id, event_id, ticket_type_id) → ticket_type`; (2) app: el motor de
  reserva valida evento vendible (estado + ventanas de venta), pertenencia, categoría y
  límites por pedido dentro de la misma transacción. Verificado: hold con asiento de otro
  evento → 400. `createCheckout` además rechaza cobrar si el evento se cerró/canceló
  después de reservar.

### H2 — Validación de entrada en la gestión de eventos 🟢 (C2 parcial)
- Los endpoints nuevos (`/events`, `/events/:id/ticket-types`, `/venues`) validan y
  normalizan todo lo que reciben (`events/input.ts`: longitudes, enteros con rango,
  fechas, emails, URLs http/https, zona horaria IANA, enums) → 400 con mensaje claro.
  Solo el rol `promotor` escribe. C2 sigue abierto para el resto de la API.

### H3 — Cobro sin entrada si se pagaba con la reserva caducada ✅ RESUELTO (2026-10-03)
- El sweeper liberaba reservas caducadas aunque tuvieran un PaymentIntent vivo. Si el
  comprador pagaba después y la plaza ya era de otro, Stripe cobraba, el webhook chocaba
  con la anti-sobreventa (500) y Stripe lo reintentaba sin fin: **cobrado sin entrada**.
- **Corregido**: `HoldReleaseService` — una reserva con pago iniciado solo se libera tras
  CANCELAR el cobro en la pasarela (`PaymentProvider.cancelIntent`); si la pasarela dice
  que ya se cobró / está en proceso, se respeta y el webhook emite. La liberación perezosa
  (dentro de tx) ya no toca reservas con pago. Defensa adicional en el webhook: cobro
  sobre reserva liberada y plaza ocupada → pedido CANCELLED + outbox
  `order.refund_required`, sin bucle de reintentos. Probado contra Stripe real (14/14).
- ⚠️ Pendiente: `order.refund_required` aún solo se registra (el worker lo marca como
  desconocido); falta el reembolso automático por la pasarela.

### H4 — Datos personales de asistentes (RGPD) 🟡 MAYORMENTE RESUELTO (2026-10-04)
- **Hecho**: información del art. 13 al comprar (responsable = promotor, finalidad, plazo,
  contacto para derechos, enlaces a privacidad y condiciones); borrado automático de datos de
  asistentes de reservas no pagadas (24 h) y de entradas N días tras el evento (por promotor,
  365 por defecto); consola «Privacidad»: acceso (exportar JSON) y supresión por email, con
  constancia en audit_log sin el email en claro. Las facturas se conservan (obligación legal).
- **Falta**: contrato de encargo del tratamiento plataforma↔promotor (art. 28), registro de
  actividades, y decidir conservación de `order.buyer_email` (hoy indefinida).
- Desde la migración `0011` cada entrada puede guardar datos del asistente que pida el
  promotor (`ticket.attendee`, `hold_seat.attendee`): nombre, email, teléfono, **DNI/NIE**,
  fecha de nacimiento… Protegidos por RLS como el resto (cada promotor solo ve los suyos).
- **Falta para producción**: texto legal / consentimiento en el formulario (quién es el
  responsable del tratamiento: el promotor; la plataforma es encargada), **plazo de
  conservación** y borrado/anonimización tras el evento, y atender derechos de acceso y
  supresión. Los datos de reservas que no llegan a pagarse (`hold_seat.attendee`) deberían
  borrarse al liberar la reserva.

## Addendum seguridad — 2026-10-04

### I1 — Sin límite de peticiones ✅ RESUELTO
- Guard global `RateLimitGuard` con contadores en Redis (en memoria si cae): login 10/15 min
  por cuenta y 50 por IP; reservas 30/10 min, checkout 20/10 min y códigos de descuento
  15/10 min por IP. 429 con Retry-After. Detrás de un proxy, `TRUST_PROXY` para la IP real.
- Las rutas que llama el SERVIDOR de la tienda (no el navegador) no se limitan por IP (todos
  los compradores compartirían la del servidor): `confirm-return` se apoya en la firma.

## Categoría 3 — Anotar y olvidar

- **D2**: PK usa `gen_random_uuid()` (v4) pero §5 dice UUID v7. Comentado en código;
  migrar cuando haya `uuidv7()` nativo.
- **D3**: cadena de conexión con contraseña dev *hardcodeada* como fallback en
  `tenant-db.service.ts` y `client.ts`. Mejor fallar si falta la env.
- **D4**: tabla `order` es palabra reservada SQL (funciona citada; footgun en SQL crudo).
- **D6**: FKs de `hold_seat` sin índice → coste en locks/joins por `hold_id`.

---

## Aspectos sólidos confirmados (no requieren acción)

- FKs **compuestas con `tenant_id`** en tablas de negocio: impiden referencias
  cruzadas entre tenants por esquema.
- `FORCE ROW LEVEL SECURITY` + rol `app_user` sin BYPASSRLS + `set_config` en la
  **misma transacción** (evita el problema del pooler).
- Dinero en `bigint`, estados como enums, append-only en `check_in`, idempotencia
  de webhooks por `(provider, event_id)`.
- Aislamiento demostrado por HTTP en las tablas con RLS (lectura, fail-closed,
  escritura cross-tenant rechazada por `WITH CHECK`).
