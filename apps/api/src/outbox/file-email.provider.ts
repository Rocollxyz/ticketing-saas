import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { EmailMessage, EmailProvider } from "./email-provider";

/**
 * Proveedor de email de DESARROLLO: en vez de enviar de verdad, escribe el correo y
 * sus adjuntos (los PDF de las entradas) en una carpeta local. Así se puede ver/abrir
 * la entrega sin SMTP. Carpeta: DEV_MAIL_DIR (por defecto <raíz del monorepo>/dev-outbox,
 * independiente del cwd: `npm run dev` arranca la API dentro de apps/api).
 */
@Injectable()
export class FileEmailProvider implements EmailProvider {
  readonly name = "file";
  private readonly logger = new Logger(FileEmailProvider.name);
  private readonly baseDir = process.env.DEV_MAIL_DIR ?? resolve(__dirname, "../../../../dev-outbox");

  async send(msg: EmailMessage): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = msg.to.replace(/[^a-zA-Z0-9@._-]/g, "_");
    const dir = join(this.baseDir, `${stamp}__${safeTo}`);
    await mkdir(dir, { recursive: true });

    const attachLines = (msg.attachments ?? []).map((a) => `  - ${a.filename}`).join("\n");
    const body =
      `To: ${msg.to}\n` +
      `Subject: ${msg.subject}\n` +
      `Adjuntos:\n${attachLines || "  (ninguno)"}\n` +
      `\n${msg.text}\n`;
    await writeFile(join(dir, "mail.txt"), body, "utf8");

    for (const a of msg.attachments ?? []) {
      await writeFile(join(dir, a.filename), a.content);
    }

    this.logger.log(`email "${msg.subject}" → ${msg.to} (${dir})`);
  }
}
