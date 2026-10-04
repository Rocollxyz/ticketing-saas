import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { BillingService } from "./billing.service";

/** Facturación del promotor (JWT; rol comprobado en el servicio). */
@Controller("invoices")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** ?from=&to= (ISO) */
  @Get()
  list(@Query() q: { from?: string; to?: string }) {
    return this.billing.list(q);
  }

  /** Libro registro de facturas expedidas (CSV). Ruta estática antes de ":id". */
  @Get("export.csv")
  async export(@Query() q: { from?: string; to?: string }, @Res({ passthrough: true }) res: Response) {
    const { filename, body } = await this.billing.exportCsv(q);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return body;
  }

  @Post("issue-pending")
  issuePending() {
    return this.billing.issuePending();
  }

  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, body } = await this.billing.pdfFile(id);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return new StreamableFile(body, { type: "application/pdf" });
  }

  /** Canje por factura completa: { customer: { name, taxId, address, postalCode, city, country? } }. */
  @Post(":id/replace")
  replace(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.billing.replace(id, body ?? {});
  }
}
