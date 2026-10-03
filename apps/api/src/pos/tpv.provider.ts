import { Injectable } from "@nestjs/common";

/**
 * Adaptador del datáfono (TPV físico de taquilla). Mismo patrón que PaymentProvider
 * (Stripe), pero para cobro presencial con tarjeta. En dev usamos FakeTpvProvider,
 * que simula la aprobación del terminal; en producción se integraría el SDK del
 * datáfono real (Redsys TPV, SumUp, etc.) sin tocar el resto del POS.
 */

export interface TpvCharge {
  approved: boolean;
  ref: string;
}

export interface TpvProvider {
  readonly name: string;
  /** Cobra en el terminal físico. Devuelve la referencia de la operación. */
  charge(amountCents: bigint, currency: string): Promise<TpvCharge>;
}

export const TPV_PROVIDER = Symbol("TPV_PROVIDER");

@Injectable()
export class FakeTpvProvider implements TpvProvider {
  readonly name = "tpv";

  async charge(_amountCents: bigint, _currency: string): Promise<TpvCharge> {
    // Simula el ida y vuelta con el terminal (inserción de tarjeta + aprobación).
    await new Promise((r) => setTimeout(r, 150));
    return { approved: true, ref: `tpv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
  }
}
