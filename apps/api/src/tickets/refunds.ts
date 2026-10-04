import { BadRequestException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { TenantDb } from "../database/tenant-db.service";

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

/** Marca del pago de las invitaciones (TicketsService): no hay nada que devolver. */
export const INVITATION_REF = "INVITACION";

/** Pasarelas que devuelven solas; el resto (efectivo, datáfono) se devuelve en mano. */
const ONLINE_PROVIDERS = new Set(["stripe", "redsys"]);

/** Pago cobrado del pedido y cuánto queda por devolver (las devoluciones fallidas no cuentan). */
export async function orderPaymentTx(tx: Tx, orderId: string) {
  const [pay] = await tx
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.orderId, orderId), inArray(schema.payment.status, ["CAPTURED", "REFUNDED"])))
    .limit(1);
  if (!pay || pay.providerRef === INVITATION_REF) return null;
  const [{ refunded }] = await tx
    .select({ refunded: sql<number>`coalesce(sum(${schema.refund.amountCents}), 0)`.mapWith(Number) })
    .from(schema.refund)
    .where(and(eq(schema.refund.orderId, orderId), ne(schema.refund.status, "FAILED")));
  const amount = Number(pay.amountCents);
  return { payment: pay, amount, refundable: Math.max(0, amount - refunded) };
}

/**
 * Lo pagado por unas entradas. Las emitidas antes de guardar el precio (price_cents
 * null) se estiman repartiendo el pedido a partes iguales: `estimated` lo indica.
 */
export async function ticketsPaidTx(tx: Tx, orderId: string, ticketIds: string[]) {
  const all = await tx
    .select({ id: schema.ticket.id, priceCents: schema.ticket.priceCents })
    .from(schema.ticket)
    .where(eq(schema.ticket.orderId, orderId));
  const pay = await orderPaymentTx(tx, orderId);
  const share = pay && all.length ? Math.floor(pay.amount / all.length) : 0;
  let total = 0;
  let estimated = false;
  for (const t of all.filter((t) => ticketIds.includes(t.id))) {
    if (t.priceCents == null) estimated = true;
    total += t.priceCents ?? share;
  }
  return { paidCents: total, estimated };
}

/**
 * Crea la devolución de un pedido (en la transacción del llamador). Online → PENDING y
 * el outbox la envía a la pasarela; taquilla → MANUAL (el promotor la marca al
 * devolverla). Devuelve null si no hay nada que devolver (gratis/invitación).
 */
export async function createRefundTx(
  tx: Tx,
  args: {
    tenantId: string;
    orderId: string;
    ticketIds: string[];
    amountCents: number;
    reason: string | null;
    createdBy: string | null;
  },
) {
  if (!Number.isInteger(args.amountCents) || args.amountCents < 0) {
    throw new BadRequestException("Importe a devolver inválido");
  }
  if (args.amountCents === 0) return null;
  const pay = await orderPaymentTx(tx, args.orderId);
  if (!pay) return null;
  if (args.amountCents > pay.refundable) {
    throw new BadRequestException(
      `Del pedido solo quedan ${(pay.refundable / 100).toFixed(2).replace(".", ",")} € por devolver`,
    );
  }
  const online = ONLINE_PROVIDERS.has(pay.payment.provider);
  const [r] = await tx
    .insert(schema.refund)
    .values({
      tenantId: args.tenantId,
      orderId: args.orderId,
      paymentId: pay.payment.id,
      amountCents: args.amountCents,
      status: online ? "PENDING" : "MANUAL",
      ticketIds: args.ticketIds,
      reason: args.reason,
      createdBy: args.createdBy,
    })
    .returning();
  if (online) {
    await tx.insert(schema.outbox).values({
      tenantId: args.tenantId,
      type: "refund.process",
      payload: { refundId: r.id },
    });
  }
  return r;
}
