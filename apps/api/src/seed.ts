/**
 * Seed de provisión (desarrollo). Crea un tenant + usuario admin + membership por
 * la vía privilegiada (DATABASE_URL superusuario), que es el camino legítimo de
 * onboarding (resuelve el chicken-and-egg de RLS — B3 en SECURITY_AUDIT.md).
 *
 * Uso:  node apps/api/dist/seed.js
 */
import { schema } from "@ticketing/database";
import * as bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/ticketing";
  const client = postgres(url);
  const db = drizzle(client, { schema });

  const email = "admin@demo.test";
  const password = "demo1234";
  const slug = "demo";

  // tenant
  let [t] = await db.select().from(schema.tenant).where(eq(schema.tenant.slug, slug));
  if (!t) {
    [t] = await db
      .insert(schema.tenant)
      .values({ name: "Demo Promotor", slug })
      .returning();
  }

  // user
  let [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!u) {
    [u] = await db
      .insert(schema.user)
      .values({
        email,
        passwordHash: await bcrypt.hash(password, 10),
        name: "Admin Demo",
      })
      .returning();
  }

  // membership
  const existing = await db
    .select()
    .from(schema.membership)
    .where(eq(schema.membership.userId, u.id));
  if (existing.length === 0) {
    await db
      .insert(schema.membership)
      .values({ tenantId: t.id, userId: u.id, role: "promotor" });
  }

  // usuario PORTERO (rol de acceso, Fase 4)
  const porteroEmail = "portero@demo.test";
  let [pu] = await db.select().from(schema.user).where(eq(schema.user.email, porteroEmail));
  if (!pu) {
    [pu] = await db
      .insert(schema.user)
      .values({
        email: porteroEmail,
        passwordHash: await bcrypt.hash("portero123", 10),
        name: "Portero Demo",
      })
      .returning();
  }
  const porteroMem = await db
    .select()
    .from(schema.membership)
    .where(eq(schema.membership.userId, pu.id));
  if (porteroMem.length === 0) {
    await db.insert(schema.membership).values({ tenantId: t.id, userId: pu.id, role: "portero" });
  }

  // usuario TAQUILLERO (POS de taquilla, Fase 5)
  const taqEmail = "taquillero@demo.test";
  let [tu] = await db.select().from(schema.user).where(eq(schema.user.email, taqEmail));
  if (!tu) {
    [tu] = await db
      .insert(schema.user)
      .values({
        email: taqEmail,
        passwordHash: await bcrypt.hash("taquillero123", 10),
        name: "Taquillero Demo",
      })
      .returning();
  }
  const taqMem = await db
    .select()
    .from(schema.membership)
    .where(eq(schema.membership.userId, tu.id));
  if (taqMem.length === 0) {
    await db.insert(schema.membership).values({ tenantId: t.id, userId: tu.id, role: "taquillero" });
  }

  // usuario ROOT de la PLATAFORMA (Admin SaaS, Fase 6) — sin tenant ni membership
  const rootEmail = "root@platform.test";
  const [existingRoot] = await db.select().from(schema.user).where(eq(schema.user.email, rootEmail));
  if (!existingRoot) {
    await db.insert(schema.user).values({
      email: rootEmail,
      passwordHash: await bcrypt.hash("root1234", 10),
      name: "Plataforma Root",
      platformAdmin: true,
    });
  }

  // evento + zona + asientos (para probar el motor de reserva)
  let [ev] = await db
    .select()
    .from(schema.event)
    .where(eq(schema.event.tenantId, t.id));
  if (!ev) {
    [ev] = await db
      .insert(schema.event)
      .values({ tenantId: t.id, name: "Demo Event", status: "ON_SALE" })
      .returning();
    const [zn] = await db
      .insert(schema.zone)
      .values({ tenantId: t.id, eventId: ev.id, name: "General" })
      .returning();
    await db.insert(schema.seat).values(
      Array.from({ length: 5 }, (_, i) => ({
        tenantId: t.id,
        eventId: ev.id,
        zoneId: zn.id,
        fila: "A",
        numero: i + 1,
      })),
    );
  }

  // categorías de precio + precio vigente (idempotente)
  async function ensureType(name: string, amountCents: bigint) {
    let [tt] = await db
      .select()
      .from(schema.ticketType)
      .where(and(eq(schema.ticketType.eventId, ev.id), eq(schema.ticketType.name, name)));
    if (!tt) {
      [tt] = await db
        .insert(schema.ticketType)
        .values({ tenantId: t.id, eventId: ev.id, name })
        .returning();
    }
    const [pr] = await db
      .select()
      .from(schema.price)
      .where(eq(schema.price.ticketTypeId, tt.id));
    if (!pr) {
      await db
        .insert(schema.price)
        .values({ tenantId: t.id, ticketTypeId: tt.id, amountCents, currency: "EUR" });
    }
    return tt;
  }
  const general = await ensureType("General", 2500n); // 25,00 €
  const vip = await ensureType("VIP", 5000n); // 50,00 €

  // asignar categoría a los asientos sin ticket_type (A1-A3 General, A4-A5 VIP)
  const seats = await db
    .select({
      id: schema.seat.id,
      numero: schema.seat.numero,
      ticketTypeId: schema.seat.ticketTypeId,
      posX: schema.seat.posX,
    })
    .from(schema.seat)
    .where(eq(schema.seat.eventId, ev.id));
  for (const s of seats) {
    const patch: Partial<typeof schema.seat.$inferInsert> = {};
    if (!s.ticketTypeId) patch.ticketTypeId = s.numero <= 3 ? general.id : vip.id;
    // Plano por defecto: General (A1-A3) en fila trasera (y=1), VIP (A4-A5) delante
    // (y=0, cerca del escenario). El promotor puede recolocarlos en el editor.
    if (s.posX == null) {
      patch.posX = s.numero <= 3 ? s.numero - 1 : s.numero - 4;
      patch.posY = s.numero <= 3 ? 1 : 0;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(schema.seat).set(patch).where(eq(schema.seat.id, s.id));
    }
  }

  // eslint-disable-next-line no-console
  console.log("Seed OK:", {
    tenant: slug,
    email,
    password,
    portero: "portero@demo.test / portero123",
    taquillero: "taquillero@demo.test / taquillero123",
    plataforma: "root@platform.test / root1234",
    eventId: ev.id,
    seatIds: seats.map((s) => s.id),
    precios: { General: "25,00€ (A1-A3)", VIP: "50,00€ (A4-A5)" },
  });
  await client.end({ timeout: 5 });
}

void main();
