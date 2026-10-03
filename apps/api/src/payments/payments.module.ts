import { Global, Module } from "@nestjs/common";
import { FakeProvider } from "./fake.provider";
import { PAYMENT_PROVIDER } from "./payment-provider";
import { StripeProvider } from "./stripe.provider";

/**
 * Provee el PaymentProvider según PAYMENTS_PROVIDER (default 'fake' en dev).
 * Global para inyectarlo donde haga falta por el token PAYMENT_PROVIDER.
 */
@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () => {
        const which = process.env.PAYMENTS_PROVIDER ?? "fake";
        return which === "stripe" ? new StripeProvider() : new FakeProvider();
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
