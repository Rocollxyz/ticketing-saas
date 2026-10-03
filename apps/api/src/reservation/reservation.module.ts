import { Module } from "@nestjs/common";
import { HoldReleaseService } from "./hold-release.service";
import { HoldSweeperService } from "./hold-sweeper.service";
import { ReservationController } from "./reservation.controller";
import { ReservationService } from "./reservation.service";

@Module({
  controllers: [ReservationController],
  providers: [ReservationService, HoldSweeperService, HoldReleaseService],
  exports: [ReservationService, HoldReleaseService],
})
export class ReservationModule {}
