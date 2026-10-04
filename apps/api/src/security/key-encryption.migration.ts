import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { eq, notLike } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { seal } from "./secret-box";

/**
 * Al arrancar, cifra las claves de firma de QR que aún estén en claro (las creadas antes
 * del cifrado en reposo). Idempotente: las ya cifradas no se tocan.
 */
@Injectable()
export class KeyEncryptionMigration implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeyEncryptionMigration.name);

  constructor(private readonly admin: AdminDb) {}

  async onApplicationBootstrap() {
    const plain = await this.admin.db
      .select({ id: schema.eventSigningKey.id, k: schema.eventSigningKey.encryptedKey })
      .from(schema.eventSigningKey)
      .where(notLike(schema.eventSigningKey.encryptedKey, "v1:%"));
    for (const r of plain) {
      await this.admin.db
        .update(schema.eventSigningKey)
        .set({ encryptedKey: seal(r.k), updatedAt: new Date() })
        .where(eq(schema.eventSigningKey.id, r.id));
    }
    if (plain.length) this.logger.log(`${plain.length} clave(s) de firma cifradas en reposo`);
  }
}
