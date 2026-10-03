-- SECURITY_AUDIT A1-bis: `user` es global (sin tenant_id, sin RLS) y app_user podía
-- enumerar email + password_hash de TODOS los usuarios de todos los tenants.
--
-- Decisión: la búsqueda global por email (login) y el alta de usuarios (onboarding de
-- promotores, seed) son operaciones de autenticación/provisión, previas al contexto de
-- tenant, y ya van por la conexión privilegiada (AdminDb). La API bajo RLS (app_user)
-- no necesita esta tabla para nada → se le retira todo acceso. Si en el futuro la app
-- necesita datos de usuario (nombre del actor, etc.), exponerlos con una vista acotada
-- SIN password_hash, no devolviendo el GRANT sobre la tabla.
REVOKE ALL ON "user" FROM app_user;
