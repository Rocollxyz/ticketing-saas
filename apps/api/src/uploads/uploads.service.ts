import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import sharp from "sharp";
import { getStore } from "../database/tenant-context";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage.provider";

export type ImageKind = "event" | "cover" | "logo";

/** Tamaño máximo (lado mayor) por uso. Nunca se amplía una imagen pequeña. */
const MAX_SIDE: Record<ImageKind, number> = { event: 1600, cover: 2400, logo: 512 };
const ACCEPTED = new Set(["jpeg", "png", "webp", "gif", "avif"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Subida de imágenes del promotor. La imagen NO se guarda tal cual: se decodifica y se
 * vuelve a codificar con sharp. Eso (1) descarta ficheros que no son imágenes de verdad
 * aunque digan serlo (polyglots, SVG con script…), (2) elimina metadatos EXIF —incluida
 * la geolocalización de las fotos del móvil—, (3) corrige la orientación y (4) la deja
 * en WebP a un tamaño razonable para la web.
 */
@Injectable()
export class UploadsService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async uploadImage(file: Express.Multer.File | undefined, kind: ImageKind) {
    if (getStore()!.role !== "promotor") {
      throw new ForbiddenException("Solo el promotor puede subir imágenes");
    }
    if (!file?.buffer?.length) throw new BadRequestException("No se ha recibido ninguna imagen");
    if (!(kind in MAX_SIDE)) throw new BadRequestException("Tipo de imagen inválido");

    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      // limitInputPixels: evita "bombas" de descompresión (imágenes gigantes en pocos KB).
      const img = sharp(file.buffer, { limitInputPixels: 50_000_000, animated: false });
      const meta = await img.metadata();
      if (!meta.format || !ACCEPTED.has(meta.format)) {
        throw new BadRequestException("Formato no admitido: usa JPG, PNG, WebP, GIF o AVIF");
      }
      out = await img
        .rotate() // aplica la orientación EXIF antes de descartar los metadatos
        .resize({ width: MAX_SIDE[kind], height: MAX_SIDE[kind], fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException("El archivo no es una imagen válida");
    }

    const key = `${getStore()!.tenantId}/${kind}-${randomUUID()}.webp`;
    const url = await this.storage.put(key, out.data, "image/webp");
    return { url, width: out.info.width, height: out.info.height, bytes: out.info.size };
  }
}
