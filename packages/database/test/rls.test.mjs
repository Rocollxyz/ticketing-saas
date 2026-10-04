// Test anti-fuga entre promotores (SECURITY_AUDIT A2). Falla si:
//  1. alguna tabla con columna `tenant_id` (o `tenant`) no tiene RLS ENABLE + FORCE y
//     una política;
//  2. como `app_user` con un tenant inventado se ve alguna fila de cualquier tabla
//     aislada (fuga de lectura);
//  3. como `app_user` se puede insertar una fila a nombre de OTRO tenant (fuga de
//     escritura: la política WITH CHECK debe impedirlo).
//
// Uso: DATABASE_URL (superusuario, para leer el catálogo) y DATABASE_URL_APP (app_user).
//   node --test packages/database/test/
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import postgres from "postgres";

const admin = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL_APP, { max: 1, onnotice: () => {} });

/** Tablas que NO llevan tenant_id a propósito (globales o de sistema). */
const GLOBAL = new Set(["user", "processed_webhook_event", "__drizzle_migrations"]);

let tables = [];

before(async () => {
  tables = await admin`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
           (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
           exists (select 1 from information_schema.columns col
                   where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id') as has_tenant
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;
});

after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

test("toda tabla con tenant_id tiene RLS (ENABLE + FORCE) y política", () => {
  const isolated = tables.filter((t) => t.has_tenant || t.name === "tenant");
  assert.ok(isolated.length > 10, `pocas tablas aisladas (${isolated.length}): ¿catálogo vacío?`);
  const bad = isolated.filter((t) => !t.rls || !t.force || t.policies === 0);
  assert.deepEqual(
    bad.map((t) => `${t.name} (rls=${t.rls}, force=${t.force}, políticas=${t.policies})`),
    [],
    "tablas con tenant_id SIN aislamiento completo",
  );
});

test("las tablas sin tenant_id son solo las globales conocidas", () => {
  const unknown = tables.filter((t) => !t.has_tenant && t.name !== "tenant" && !GLOBAL.has(t.name));
  assert.deepEqual(
    unknown.map((t) => t.name),
    [],
    "tabla nueva sin tenant_id: añádele tenant_id + RLS o, si es global a propósito, inclúyela en GLOBAL",
  );
});

test("app_user con un tenant inventado no ve ninguna fila", async () => {
  const isolated = tables.filter((t) => t.has_tenant || t.name === "tenant");
  const leaks = [];
  await app.begin(async (tx) => {
    await tx`select set_config('app.current_tenant_id', ${randomUUID()}, true)`;
    for (const t of isolated) {
      const [{ n }] = await tx`select count(*)::int as n from ${tx(t.name)}`;
      if (n > 0) leaks.push(`${t.name}: ${n} filas`);
    }
  });
  assert.deepEqual(leaks, [], "fuga de lectura entre tenants");
});

test("app_user sin tenant fijado no ve ninguna fila (fail-closed)", async () => {
  const [{ n }] = await app`select count(*)::int as n from "event"`;
  assert.equal(n, 0);
});

test("app_user no puede escribir a nombre de otro tenant", async () => {
  const [victim] = await admin`select id from tenant limit 1`;
  if (!victim) return; // BD vacía (CI recién migrada): nada que robar
  await assert.rejects(
    app.begin(async (tx) => {
      await tx`select set_config('app.current_tenant_id', ${randomUUID()}, true)`;
      await tx`insert into audit_log (tenant_id, action) values (${victim.id}, 'rls-test')`;
    }),
    /row-level security/,
    "se pudo insertar en otro tenant",
  );
});
