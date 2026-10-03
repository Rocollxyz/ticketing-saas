import { Controller, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { type ImageKind, MAX_UPLOAD_BYTES, UploadsService } from "./uploads.service";

/** Subida de imágenes (JWT, promotor). multipart/form-data con el campo `file`. */
@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("images")
  @UseInterceptors(
    FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Query("kind") kind: ImageKind) {
    return this.uploads.uploadImage(file, kind);
  }
}
