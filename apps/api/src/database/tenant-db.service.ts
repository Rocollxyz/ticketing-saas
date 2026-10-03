import { ForbiddenException, Injectable, OnModuleDestroy } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getTenantId } from "./tenant-context";

type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Acceso a datos con aislamiento por tenant garantizado por RLS.
 *
 * Se conecta SIEMPRE como `app_user` (sin BYPASSRLS). Cada operación corre dentro
 * de una transacción que primero fija `app.current_tenant_id` con set_config(...,
 * true) — equivalente a SET LOCAL, atado a esa transacción/conexión (§7).
 *
 * Importante: usar set_config en la MISMA transacción evita el problema del pooler
 * (que una conexión reciclada herede el tenant de otra request).
 */
@Injectable()
export class TenantDb implements OnModuleDestroy {
  private readonly client: postgres.Sql;
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor() {
    const url =
      process.env.DATABASE_URL_APP ??
      "postgres://app_user:app_user_dev@localhost:5432/ticketing";
    this.client = postgres(url);
    this.db = drizzle(this.client, { schema });
  }

  /**
   * Ejecuta `work` dentro de una transacción con el contexto de tenant fijado.
   * Lanza si no hay tenant en contexto (fail-closed en la capa de app; RLS es la
   * segunda red).
   */
  async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenException("Sin contexto de tenant");
    }
    return this.runAs(tenantId, work);
  }

  /**
   * Igual que run() pero con el tenant fijado explícitamente, no desde el contexto
   * de la request. Lo usa el webhook de pagos, que llega SIN JWT: el tenant se
   * resuelve del pago (vía AdminDb) y se pasa aquí para que RLS siga aplicando.
   */
  async runAs<T>(tenantId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
      );
      return work(tx);
    });
  }

  async onModuleDestroy() {
    await this.client.end({ timeout: 5 });
  }
}
