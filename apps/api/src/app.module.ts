import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { AccessModule } from "./access/access.module";
import { AuthModule } from "./auth/auth.module";
import { CheckoutModule } from "./checkout/checkout.module";
import { TenantMiddleware } from "./common/tenant.middleware";
import { BillingModule } from "./billing/billing.module";
import { CouponsModule } from "./coupons/coupons.module";
import { FaresModule } from "./fares/fares.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health/health.controller";
import { OutboxModule } from "./outbox/outbox.module";
import { PaymentsModule } from "./payments/payments.module";
import { PlatformModule } from "./platform/platform.module";
import { PosModule } from "./pos/pos.module";
import { PrivacyModule } from "./privacy/privacy.module";
import { ProfileModule } from "./profile/profile.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SecurityModule } from "./security/security.module";
import { ReservationModule } from "./reservation/reservation.module";
import { SeatmapModule } from "./seatmap/seatmap.module";
import { StorefrontModule } from "./storefront/storefront.module";
import { TicketsModule } from "./tickets/tickets.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    // Bus de eventos in-process: el dominio emite, el gateway de tiempo real escucha.
    EventEmitterModule.forRoot(),
    // Tareas programadas (sweeper de holds expirados).
    ScheduleModule.forRoot(),
    DatabaseModule,
    SecurityModule,
    PaymentsModule,
    AuthModule,
    EventsModule,
    TicketsModule,
    CouponsModule,
    FaresModule,
    BillingModule,
    PrivacyModule,
    ReservationModule,
    CheckoutModule,
    StorefrontModule,
    SeatmapModule,
    RealtimeModule,
    OutboxModule,
    AccessModule,
    PosModule,
    PlatformModule,
    ProfileModule,
    UploadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // El contexto de tenant (vía JWT) aplica a toda la API salvo rutas públicas:
    // health check, login y webhooks de pago (estos se autentican por firma).
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: "health", method: RequestMethod.ALL },
        { path: "auth/login", method: RequestMethod.ALL },
        { path: "webhooks/(.*)", method: RequestMethod.ALL },
        { path: "shop/(.*)", method: RequestMethod.ALL },
        // Imágenes públicas (las sirve express.static antes de llegar aquí; por si acaso).
        { path: "uploads/(.*)", method: RequestMethod.GET },
      )
      .forRoutes("*");
  }
}
