import { Global, Module } from "@nestjs/common";
import { AdminDb } from "./admin-db.service";
import { TenantDb } from "./tenant-db.service";

/**
 * Módulo de base de datos. Global para que TenantDb (datos de negocio, RLS) y
 * AdminDb (auth/provisión, privilegiado) estén disponibles en toda la API.
 */
@Global()
@Module({
  providers: [TenantDb, AdminDb],
  exports: [TenantDb, AdminDb],
})
export class DatabaseModule {}
