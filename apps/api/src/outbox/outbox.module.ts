import { Module } from "@nestjs/common";
import { EMAIL_PROVIDER } from "./email-provider";
import { FileEmailProvider } from "./file-email.provider";
import { OutboxWorkerService } from "./outbox-worker.service";
import { TicketPdfService } from "./ticket-pdf.service";

/**
 * Procesado del transactional outbox (entrega de entradas por email/PDF). El proveedor
 * de email se elige por env (de momento solo 'file' para dev). AdminDb llega del
 * DatabaseModule global.
 */
@Module({
  providers: [
    OutboxWorkerService,
    TicketPdfService,
    { provide: EMAIL_PROVIDER, useClass: FileEmailProvider },
  ],
})
export class OutboxModule {}
