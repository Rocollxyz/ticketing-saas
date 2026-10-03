import { Module } from "@nestjs/common";
import { CheckoutModule } from "../checkout/checkout.module";
import { ReservationModule } from "../reservation/reservation.module";
import { StorefrontController } from "./storefront.controller";
import { StorefrontService } from "./storefront.service";

@Module({
  imports: [ReservationModule, CheckoutModule],
  controllers: [StorefrontController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
