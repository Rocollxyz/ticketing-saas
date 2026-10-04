import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { KeyEncryptionMigration } from "./key-encryption.migration";
import { RateLimitGuard } from "./rate-limit.guard";
import { RateLimitService } from "./rate-limit.service";

/**
 * Protecciones transversales: límite de peticiones (guard global, reglas por ruta) y
 * cifrado en reposo de las claves de firma de QR.
 */
@Global()
@Module({
  providers: [RateLimitService, KeyEncryptionMigration, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [RateLimitService],
})
export class SecurityModule {}
