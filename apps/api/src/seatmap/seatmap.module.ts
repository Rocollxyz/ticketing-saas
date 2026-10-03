import { Module } from "@nestjs/common";
import { SeatmapController } from "./seatmap.controller";
import { SeatmapService } from "./seatmap.service";

@Module({
  controllers: [SeatmapController],
  providers: [SeatmapService],
})
export class SeatmapModule {}
