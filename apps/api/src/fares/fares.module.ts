import { Module } from "@nestjs/common";
import { FaresController } from "./fares.controller";
import { FaresService } from "./fares.service";

@Module({
  controllers: [FaresController],
  providers: [FaresService],
})
export class FaresModule {}
