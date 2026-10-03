import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { eq } from "drizzle-orm";
import * as input from "../common/input";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

/** Recintos del promotor (reutilizables entre eventos). Bajo RLS. */
@Injectable()
export class VenuesService {
  constructor(private readonly db: TenantDb) {}

  private assertPromoter() {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede gestionar recintos");
    }
  }

  list() {
    return this.db.run((tx) => tx.select().from(schema.venue).orderBy(schema.venue.name));
  }

  create(body: Record<string, unknown>) {
    this.assertPromoter();
    const data = this.parse(body, true);
    const tenantId = getStore()!.tenantId;
    return this.db.run(async (tx) => {
      const [v] = await tx
        .insert(schema.venue)
        .values({ ...data, name: data.name!, tenantId })
        .returning();
      return v;
    });
  }

  update(venueId: string, body: Record<string, unknown>) {
    this.assertPromoter();
    const data = this.parse(body, false);
    return this.db.run(async (tx) => {
      const [v] = await tx
        .update(schema.venue)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.venue.id, venueId))
        .returning();
      if (!v) throw new NotFoundException("Recinto no encontrado");
      return v;
    });
  }

  private parse(b: Record<string, unknown>, creating: boolean) {
    return input.defined({
      name: input.text(b.name, "Nombre del recinto", 200, creating) ?? undefined,
      address: input.text(b.address, "Dirección", 300),
      city: input.text(b.city, "Ciudad", 100),
      postalCode: input.text(b.postalCode, "Código postal", 20),
      country: input.text(b.country, "País", 2) ?? undefined,
      mapsUrl: input.url(b.mapsUrl, "Enlace al mapa"),
    });
  }
}
