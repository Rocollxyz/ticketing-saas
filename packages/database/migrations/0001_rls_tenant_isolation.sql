-- Row Level Security: aislamiento multi-tenant reforzado en la BD (§7 ARCHITECTURE.md).
-- Defensa en profundidad: aunque la app olvide un WHERE, Postgres filtra por tenant.
--
-- Contexto de sesión: la API hace, por transacción,
--   SELECT set_config('app.current_tenant_id', '<uuid>', true);   -- (= SET LOCAL)
-- y las políticas comparan tenant_id contra ese valor. Si no está fijado → 0 filas
-- (fail-closed). Se usa el modo missing_ok de current_setting para no lanzar error.

-- ─── Rol de aplicación SIN BYPASSRLS ───
-- La API se conecta como app_user (NO superusuario, NO owner) → sujeto a RLS.
-- El login/contraseña se provisiona aparte (secret manager, §7), no aquí.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- ─── Política para tablas con columna tenant_id ───
-- ENABLE + FORCE (FORCE hace que ni el owner se salte RLS).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'membership','venue','event','zone','seat','ticket_type','price',
    'order','hold','hold_seat','payment','ticket','check_in','event_signing_key'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    $f$, t);
  END LOOP;
END
$$;

-- ─── Tabla tenant: el aislamiento es por su propia PK (id) ───
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant"
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Nota: `user` (global, login por email), `processed_webhook_event` (llega antes de
-- resolver el tenant), `audit_log` y `outbox` (tenant_id nullable, escritos por el
-- sistema) quedan fuera de RLS por diseño; su acceso se controla en la capa de app.
