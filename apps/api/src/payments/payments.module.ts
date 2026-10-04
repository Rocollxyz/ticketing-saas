import { Global, Module } from "@nestjs/common";
import { PaymentRegistry } from "./payment-registry";

/** Pasarelas de pago activas (ver PaymentRegistry). Global: la usan checkout, reservas y outbox. */
@Global()
@Module({
  providers: [PaymentRegistry],
  exports: [PaymentRegistry],
})
export class PaymentsModule {}
