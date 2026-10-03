import { Module } from "@nestjs/common";
import { ReservationModule } from "../reservation/reservation.module";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";
import { FakeTpvProvider, TPV_PROVIDER } from "./tpv.provider";

/**
 * POS de taquilla (venta presencial). El proveedor de datáfono se elige por env
 * (de momento solo el fake de dev). Reutiliza el ReservationService.
 */
@Module({
  imports: [ReservationModule],
  controllers: [PosController],
  providers: [PosService, { provide: TPV_PROVIDER, useClass: FakeTpvProvider }],
})
export class PosModule {}
