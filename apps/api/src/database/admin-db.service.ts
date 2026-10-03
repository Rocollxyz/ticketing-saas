import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Conexión PRIVILEGIADA, exclusiva para autenticación y provisión (onboarding).
 *
 * La autenticación es inherentemente cross-tenant: hay que buscar un usuario por
 * email y sus `membership` ANTES de tener contexto de tenant, así que no puede ir
 * por `app_user` (que está sujeto a RLS). Esta conexión usa el rol con privilegios
 * (DATABASE_URL) y por tanto NO debe usarse jamás para datos de negocio: solo
 * auth y alta de tenants/usuarios.
 *
 * Nota de auditoría: este es el camino legítimo que resuelve el chicken-and-egg de
 * onboarding (B3 en SECURITY_AUDIT.md). Su superficie debe mantenerse mínima.
 */
@Injectable()
export class AdminDb implements OnModuleDestroy {
  private readonly client: postgres.Sql;
  readonly db: PostgresJsDatabase<typeof schema>;

  constructor() {
    const url =
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/ticketing";
    this.client = postgres(url);
    this.db = drizzle(this.client, { schema });
  }

  async onModuleDestroy() {
    await this.client.end({ timeout: 5 });
  }
}
