import { Module } from "@nestjs/common";
import { LocalStorageProvider, STORAGE_PROVIDER } from "./storage.provider";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, { provide: STORAGE_PROVIDER, useClass: LocalStorageProvider }],
})
export class UploadsModule {}
