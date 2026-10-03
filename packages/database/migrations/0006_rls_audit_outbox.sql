-- SECURITY_AUDIT A1: `audit_log` y `outbox` llevan tenant_id pero quedaron fuera de RLS
-- en 0001 → un tenant podía leer/alterar la auditoría y la cola de efectos de otro.
--
-- Misma política que el resto de tablas de tenant. Las filas de SISTEMA (tenant_id
-- NULL) quedan invisibles e inescribibles para app_user (NULL = x no es TRUE): solo
-- se tocan por la conexión privilegiada (AdminDb), igual que hace el worker del outbox.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log','outbox'] LOOP
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
--> statement-breakpoint

-- Append-only para la app (§5): app_user solo inserta (y lee lo suyo). Marcar
-- `outbox.processed_at` es cosa del worker, que va por AdminDb.
REVOKE UPDATE, DELETE ON "audit_log" FROM app_user;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "outbox" FROM app_user;
