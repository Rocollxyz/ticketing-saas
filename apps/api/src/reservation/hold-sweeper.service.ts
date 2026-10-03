import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Interval } from "@nestjs/schedule";
import { schema } from "@ticketing/database";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { AdminDb } from "../database/admin-db.service";
import { SEATS_RELEASED, type SeatsReleasedEvent } from "../realtime/seat-events";
import { HoldReleaseService } from "./hold-release.service";

const SWEEP_INTERVAL_MS = 20_000;

/**
 * Barrido de fondo de holds expirados (E3 en SECURITY_AUDIT.md). Hasta ahora solo
 * había liberación perezosa al crear un hold + un endpoint manual; un asiento con
 * hold caducado quedaba bloqueado hasta el siguiente intento. Este job recorre
 * TODOS los tenants (por eso usa AdminDb, privilegiado y fuera de RLS: es trabajo
 * de sistema) y, además de liberar, EMITE seats.released para que los compradores
 * vean el asiento volver a estar libre en tiempo real.
 */
@Injectable()
export class HoldSweeperService {
  private readonly logger = new Logger(HoldSweeperService.name);
  private running = false;

  constructor(
    private readonly admin: AdminDb,
    private readonly emitter: EventEmitter2,
    private readonly releaser: HoldReleaseService,
  ) {}

  @Interval("hold-sweeper", SWEEP_INTERVAL_MS)
  async sweep() {
    if (this.running) return; // evita solapamiento si una pasada se alarga
    this.running = true;
    try {
      // 1) Reservas caducadas SIN pago iniciado: se liberan en bloque.
      const released = await this.admin.db.transaction(async (tx) => {
        const expiredHolds = await tx
          .update(schema.hold)
          .set({ status: "EXPIRED" })
          .where(
            and(
              eq(schema.hold.status, "ACTIVE"),
              lt(schema.hold.expiresAt, new Date()),
              isNull(schema.hold.orderId),
            ),
          )
          .returning({ id: schema.hold.id });
        if (expiredHolds.length === 0) return [];

        return tx
          .update(schema.holdSeat)
          .set({ status: "EXPIRED" })
          .where(
            and(
              eq(schema.holdSeat.status, "ACTIVE"),
              inArray(
                schema.holdSeat.holdId,
                expiredHolds.map((h) => h.id),
              ),
            ),
          )
          .returning({ seatId: schema.holdSeat.seatId, eventId: schema.holdSeat.eventId });
      });

      // 2) Caducadas CON pago iniciado: una a una, cancelando antes el cobro en la
      //    pasarela (ver HoldReleaseService). Si ya se cobró, se mantiene.
      const withPayment = await this.admin.db
        .select({ id: schema.hold.id })
        .from(schema.hold)
        .where(
          and(
            eq(schema.hold.status, "ACTIVE"),
            lt(schema.hold.expiresAt, new Date()),
            isNotNull(schema.hold.orderId),
          ),
        )
        .limit(50);
      for (const { id } of withPayment) {
        await this.releaser.release(id, "EXPIRED").catch((e) =>
          this.logger.error(`no se pudo liberar el hold ${id}: ${e instanceof Error ? e.message : e}`),
        );
      }

      if (released.length === 0) return;

      // Agrupa los asientos liberados por evento y notifica a cada sala.
      const byEvent = new Map<string, string[]>();
      for (const { eventId, seatId } of released) {
        (byEvent.get(eventId) ?? byEvent.set(eventId, []).get(eventId)!).push(seatId);
      }
      for (const [eventId, seatIds] of byEvent) {
        this.emitter.emit(SEATS_RELEASED, { eventId, seatIds } satisfies SeatsReleasedEvent);
      }
      this.logger.debug(`liberados ${released.length} asientos en ${byEvent.size} evento(s)`);
    } catch (e) {
      this.logger.error(`fallo en el barrido de holds: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }
}
