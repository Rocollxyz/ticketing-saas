import { Injectable, Logger } from "@nestjs/common";
import { FakeProvider } from "./fake.provider";
import type { PaymentMethod, PaymentProvider } from "./payment-provider";
import { RedsysProvider } from "./redsys.provider";
import { StripeProvider } from "./stripe.provider";

/**
 * Pasarelas activas, por nombre. Puede haber varias a la vez (p. ej. Stripe para
 * tarjeta y Redsys para Bizum). Cada pago guarda con cuál se hizo, y las devoluciones y
 * cancelaciones van siempre a esa misma.
 *
 * Config:
 *   PAYMENTS_PROVIDER = stripe | redsys | fake  → pasarela de la TARJETA (por defecto fake)
 *   REDSYS_MERCHANT_CODE + REDSYS_SECRET        → activa Redsys
 *   REDSYS_BIZUM=1                              → ofrece Bizum (el banco debe tenerlo activado)
 */
@Injectable()
export class PaymentRegistry {
  private readonly logger = new Logger(PaymentRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly byMethod = new Map<PaymentMethod, PaymentProvider>();

  constructor() {
    const card = process.env.PAYMENTS_PROVIDER ?? "fake";
    const add = (p: PaymentProvider) => this.providers.set(p.name, p);
    if (card === "stripe" || process.env.STRIPE_SECRET_KEY) {
      try {
        add(new StripeProvider());
      } catch (e) {
        if (card === "stripe") throw e;
      }
    }
    if (process.env.REDSYS_MERCHANT_CODE && process.env.REDSYS_SECRET) add(new RedsysProvider());
    if (card === "fake") add(new FakeProvider());

    const cardProvider = this.providers.get(card);
    if (!cardProvider) throw new Error(`PAYMENTS_PROVIDER=${card} no está configurado`);
    this.byMethod.set("card", cardProvider);
    const redsys = this.providers.get("redsys");
    if (redsys && process.env.REDSYS_BIZUM === "1") this.byMethod.set("bizum", redsys);
    this.logger.log(
      `pasarelas: ${[...this.providers.keys()].join(", ")} · tarjeta → ${card}` +
        (this.byMethod.has("bizum") ? " · Bizum → redsys" : ""),
    );
  }

  /** La pasarela con la que se hizo un pago (para cancelar o devolver). */
  get(name: string): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  forMethod(method: PaymentMethod): PaymentProvider | undefined {
    return this.byMethod.get(method);
  }

  /** Métodos que la tienda puede ofrecer. */
  methods(): PaymentMethod[] {
    return [...this.byMethod.keys()];
  }
}
