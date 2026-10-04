import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { EMAIL_PROVIDER } from "./email-provider";
import { FileEmailProvider } from "./file-email.provider";
import { InvoiceJobsService } from "./invoice-jobs.service";
import { OutboxWorkerService } from "./outbox-worker.service";
import { RefundProcessorService } from "./refund-processor.service";
import { TicketPdfService } from "./ticket-pdf.service";

/**
 * Procesado del transactional outbox (entrega de entradas por email/PDF y devoluciones). El proveedor
 * de email se elige por env (de momento solo 'file' para dev). AdminDb llega del
 * DatabaseModule global.
 */
@Module({
  imports: [BillingModule],
  providers: [
    OutboxWorkerService,
    InvoiceJobsService,
    RefundProcessorService,
    TicketPdfService,
    { provide: EMAIL_PROVIDER, useClass: FileEmailProvider },
  ],
})
export class OutboxModule {}
