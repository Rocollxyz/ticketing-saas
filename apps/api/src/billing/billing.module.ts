import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { InvoicePdfService } from "./invoice-pdf.service";

/** Facturas de las entradas (emisor: el promotor). La emisión automática la hace el outbox. */
@Module({
  controllers: [BillingController],
  providers: [BillingService, InvoicePdfService],
  exports: [InvoicePdfService],
})
export class BillingModule {}
