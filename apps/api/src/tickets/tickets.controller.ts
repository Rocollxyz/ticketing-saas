import { Body, Controller, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { TicketsService } from "./tickets.service";

type ListQuery = { q?: string; status?: string; ticketTypeId?: string; offset?: string };

/**
 * Entradas emitidas de un evento, para la consola del promotor (JWT; el tenant sale del
 * token y el rol lo comprueba el servicio).
 */
@Controller("events/:id/tickets")
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Param("id") id: string, @Query() query: ListQuery) {
    return this.tickets.list(id, query);
  }

  /** Mismos filtros que el listado, sin paginar. */
  @Get("export.csv")
  async export(@Param("id") id: string, @Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    const { filename, body } = await this.tickets.exportCsv(id, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return body;
  }

  /** Invitaciones: { quantities: {ticketTypeId: n}, buyerName?, buyerEmail?, sendEmail? }. */
  @Post()
  issue(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.tickets.issueManual(id, body ?? {});
  }

  /** { values: {fieldId: valor} } */
  @Patch(":ticketId/attendee")
  updateAttendee(@Param("id") id: string, @Param("ticketId") ticketId: string, @Body() body: Record<string, unknown>) {
    return this.tickets.updateAttendee(id, ticketId, body ?? {});
  }

  /** { to?, wholeOrder? } */
  @Post(":ticketId/resend")
  resend(@Param("id") id: string, @Param("ticketId") ticketId: string, @Body() body: Record<string, unknown>) {
    return this.tickets.resend(id, ticketId, body ?? {});
  }

  /** Evento cancelado: anula todo y devuelve el dinero de cada pedido. */
  @Post("refund-all")
  refundAll(@Param("id") id: string) {
    return this.tickets.refundAll(id);
  }

  @Post("refunds/:refundId/retry")
  retryRefund(@Param("id") id: string, @Param("refundId") refundId: string) {
    return this.tickets.retryRefund(id, refundId);
  }

  /** Devolución de taquilla hecha en mano. */
  @Post("refunds/:refundId/done")
  refundDone(@Param("id") id: string, @Param("refundId") refundId: string) {
    return this.tickets.markRefundDone(id, refundId);
  }

  /** Entrada ya anulada: { refundCents?, reason? }. */
  @Post(":ticketId/refund")
  refund(@Param("id") id: string, @Param("ticketId") ticketId: string, @Body() body: Record<string, unknown>) {
    return this.tickets.refundVoided(id, ticketId, body ?? {});
  }

  /** { release?: boolean (por defecto true), reason?, refund?: boolean, refundCents? } */
  @Post(":ticketId/void")
  void(@Param("id") id: string, @Param("ticketId") ticketId: string, @Body() body: Record<string, unknown>) {
    return this.tickets.void(id, ticketId, body ?? {});
  }
}
