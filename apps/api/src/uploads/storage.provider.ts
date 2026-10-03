import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Almacenamiento de ficheros públicos (imágenes) por adaptador, como pagos y email.
 * Dev: disco local servido por la propia API en /uploads. Prod: un adaptador S3/R2
 * con la misma interfaz (y CDN delante) sin tocar el resto.
 */
export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

export interface StorageProvider {
  /** Guarda el fichero bajo `key` y devuelve su URL pública absoluta. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

/** Carpeta local de subidas (raíz del monorepo, independiente del cwd). */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? resolve(__dirname, "../../../../uploads");

export class LocalStorageProvider implements StorageProvider {
  private readonly publicBase =
    process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  async put(key: string, body: Buffer): Promise<string> {
    const path = join(UPLOADS_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return `${this.publicBase}/uploads/${key}`;
  }
}
