import { ForbiddenException, Injectable } from "@nestjs/common";
import { verifyTicketQr } from "@ticketing/crypto";
import { schema } from "@ticketing/database";
import { and, asc, eq } from "drizzle-orm";
import { seatLabel } from "../catalog/seat-label";
import { getStore } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

export type ScanResult = "OK" | "DUPLICATE" | "INVALID";

export interface ScanOutcome {
  result: ScanResult;
  reason?: string;
  /** `attendee`: titular, si la entrada es nominativa (para cotejar con el DNI). */
  ticket?: { id: string; seat: string; event: string; attendee?: string | null };
  previousScanAt?: string;
}

export interface OfflineCheckIn {
  token: string;
  scannedAt?: string;
  deviceId?: string;
}

/** Roles autorizados a validar accesos. */
const ACCESS_ROLES = new Set(["portero", "promotor", "admin_saas"]);

/** eventId que viaja en el QR (SIN verificar todavía) para localizar la clave. */
function peekEventId(token: string): string | null {
  try {
    const body = token.split(".")[0];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof payload?.e === "string" ? payload.e : null;
  } catch {
    return null;
  }
}

/**
 * Control de acceso (Fase 4). Valida el QR de la entrada y registra el check-in.
 * La anti-DOBLE-ENTRADA es atómica por esquema, igual que la anti-sobreventa: la
 * transición `ISSUED → CHECKED_IN` se hace con un UPDATE condicional; si dos puertas
 * escanean la misma entrada a la vez, solo una gana (la otra ve 0 filas → DUPLICATE).
 * `check_in` es append-only: se registra TODO intento (OK/DUPLICATE/INVALID) para
 * trazabilidad forense. Opera bajo RLS (contexto de tenant del JWT del portero).
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: TenantDb) {}

  private assertRole() {
    if (!ACCESS_ROLES.has(getStore()!.role)) {
      throw new ForbiddenException("Rol sin permiso de acceso");
    }
  }

  /** Valida un QR y registra el check-in (online). */
  async scan(token: string, deviceId?: string): Promise<ScanOutcome> {
    this.assertRole();
    return this.db.run((tx) => this.scanTx(tx, token, deviceId));
  }

  private async scanTx(tx: Tx, token: string, deviceId?: string, scannedAt?: Date): Promise<ScanOutcome> {
    const tenantId = getStore()!.tenantId;
    const eventId = peekEventId(token);
    if (!eventId) return { result: "INVALID", reason: "QR ilegible" };

    const [key] = await tx
      .select({ k: schema.eventSigningKey.encryptedKey })
      .from(schema.eventSigningKey)
      .where(eq(schema.eventSigningKey.eventId, eventId));
    if (!key) return { result: "INVALID", reason: "Evento desconocido" };

    const payload = verifyTicketQr(token, key.k);
    if (!payload || payload.e !== eventId) {
      return { result: "INVALID", reason: "Firma inválida" };
    }

    const [tk] = await tx
      .select({
        id: schema.ticket.id,
        status: schema.ticket.status,
        seatId: schema.ticket.seatId,
        attendeeName: schema.ticket.attendeeName,
      })
      .from(schema.ticket)
      .where(and(eq(schema.ticket.id, payload.t), eq(schema.ticket.eventId, eventId)));
    if (!tk) return { result: "INVALID", reason: "Entrada inexistente" };

    const details = async () => {
      const [row] = await tx
        .select({
          fila: schema.seat.fila,
          numero: schema.seat.numero,
          isGeneral: schema.seat.isGeneral,
          categoria: schema.ticketType.name,
          event: schema.event.name,
        })
        .from(schema.seat)
        .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
        .innerJoin(schema.event, eq(schema.event.id, eventId))
        .where(eq(schema.seat.id, tk.seatId));
      return { id: tk.id, seat: row ? seatLabel(row) : "?", event: row?.event ?? "", attendee: tk.attendeeName };
    };

    const record = (result: ScanResult) =>
      tx.insert(schema.checkIn).values({
        tenantId,
        ticketId: tk.id,
        deviceId: deviceId ?? null,
        result,
        ...(scannedAt ? { scannedAt } : {}),
      });

    if (tk.status === "VOID") {
      await record("INVALID");
      return { result: "INVALID", reason: "Entrada anulada", ticket: await details() };
    }

    // Transición atómica: solo la primera vez pasa de ISSUED a CHECKED_IN.
    const claimed = await tx
      .update(schema.ticket)
      .set({ status: "CHECKED_IN" })
      .where(and(eq(schema.ticket.id, tk.id), eq(schema.ticket.status, "ISSUED")))
      .returning({ id: schema.ticket.id });

    if (claimed.length === 1) {
      await record("OK");
      return { result: "OK", ticket: await details() };
    }

    // Ya estaba CHECKED_IN → reentrada.
    await record("DUPLICATE");
    const [first] = await tx
      .select({ at: schema.checkIn.scannedAt })
      .from(schema.checkIn)
      .where(and(eq(schema.checkIn.ticketId, tk.id), eq(schema.checkIn.result, "OK")))
      .orderBy(asc(schema.checkIn.scannedAt))
      .limit(1);
    return {
      result: "DUPLICATE",
      reason: "Entrada ya utilizada",
      ticket: await details(),
      previousScanAt: first?.at?.toISOString(),
    };
  }

  /** Paquete para validación OFFLINE: clave del evento + entradas válidas. */
  async manifest(eventId: string) {
    this.assertRole();
    return this.db.run(async (tx) => {
      const [ev] = await tx
        .select({ id: schema.event.id, name: schema.event.name, status: schema.event.status })
        .from(schema.event)
        .where(eq(schema.event.id, eventId));
      if (!ev) return null;

      const [key] = await tx
        .select({ k: schema.eventSigningKey.encryptedKey })
        .from(schema.eventSigningKey)
        .where(eq(schema.eventSigningKey.eventId, eventId));

      const tickets = await tx
        .select({
          id: schema.ticket.id,
          status: schema.ticket.status,
          fila: schema.seat.fila,
          numero: schema.seat.numero,
          isGeneral: schema.seat.isGeneral,
          categoria: schema.ticketType.name,
          attendeeName: schema.ticket.attendeeName,
        })
        .from(schema.ticket)
        .innerJoin(schema.seat, eq(schema.seat.id, schema.ticket.seatId))
        .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
        .where(eq(schema.ticket.eventId, eventId));

      return {
        event: ev,
        // NOTA seguridad: se entrega la clave de firma al dispositivo para validar
        // offline (relacionado con E1: hoy va en claro). Mitigación futura: rotación
        // por evento + clave derivada por dispositivo.
        key: key?.k ?? null,
        generatedAt: new Date().toISOString(),
        tickets: tickets.map((t) => ({ id: t.id, status: t.status, seat: seatLabel(t), attendee: t.attendeeName })),
      };
    });
  }

  /** Sincroniza check-ins capturados OFFLINE. El servidor resuelve los conflictos. */
  async sync(items: OfflineCheckIn[]) {
    this.assertRole();
    const results: Array<ScanOutcome & { token: string }> = [];
    for (const it of items) {
      const at = it.scannedAt ? new Date(it.scannedAt) : undefined;
      const outcome = await this.db.run((tx) => this.scanTx(tx, it.token, it.deviceId, at));
      results.push({ token: it.token, ...outcome });
    }
    return { synced: results.length, results };
  }
}
