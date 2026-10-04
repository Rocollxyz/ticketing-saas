import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { AttendeeFieldsService } from "./attendee-fields.service";
import { EventsService, type StatusAction } from "./events.service";
import { TicketTypesService } from "./ticket-types.service";
import { VenuesService } from "./venues.service";

/**
 * Gestión de eventos del promotor (autenticada por JWT; el tenant sale del token).
 * Leer: cualquier rol del tenant. Escribir: solo promotor (lo comprueban los servicios).
 */
@Controller("events")
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly ticketTypes: TicketTypesService,
  ) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.events.create(body ?? {});
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.events.get(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.events.update(id, body ?? {});
  }

  /** Ciclo de vida: { action: publish | unpublish | close | reopen | cancel }. */
  @Post(":id/status")
  status(@Param("id") id: string, @Body() body: { action: StatusAction }) {
    return this.events.setStatus(id, body?.action);
  }

  /** Funciones del mismo espectáculo. */
  @Get(":id/sessions")
  sessions(@Param("id") id: string) {
    return this.events.sessions(id);
  }

  /** Nueva función en otra fecha: { startsAt }. */
  @Post(":id/sessions")
  addSession(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.events.addSession(id, body ?? {});
  }

  @Post(":id/duplicate")
  duplicate(@Param("id") id: string) {
    return this.events.duplicate(id);
  }

  @Post(":id/ticket-types")
  createTicketType(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.ticketTypes.create(id, body ?? {});
  }

  @Patch(":id/ticket-types/:ttId")
  updateTicketType(
    @Param("id") id: string,
    @Param("ttId") ttId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.ticketTypes.update(id, ttId, body ?? {});
  }

  @Delete(":id/ticket-types/:ttId")
  removeTicketType(@Param("id") id: string, @Param("ttId") ttId: string) {
    return this.ticketTypes.remove(id, ttId);
  }
}

// ─── Formulario de asistentes ──────────────────────────────────────────────

@Controller("events/:id/attendee-fields")
export class AttendeeFieldsController {
  constructor(private readonly fields: AttendeeFieldsService) {}

  @Get()
  list(@Param("id") id: string) {
    return this.fields.list(id);
  }

  @Post()
  create(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.fields.create(id, body ?? {});
  }

  /** Reordenar: { ids: [...] } en el orden deseado. */
  @Post("reorder")
  reorder(@Param("id") id: string, @Body() body: { ids?: unknown }) {
    return this.fields.reorder(id, body?.ids);
  }

  @Patch(":fieldId")
  update(@Param("id") id: string, @Param("fieldId") fieldId: string, @Body() body: Record<string, unknown>) {
    return this.fields.update(id, fieldId, body ?? {});
  }

  @Delete(":fieldId")
  remove(@Param("id") id: string, @Param("fieldId") fieldId: string) {
    return this.fields.remove(id, fieldId);
  }
}

@Controller("venues")
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  list() {
    return this.venues.list();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.venues.create(body ?? {});
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.venues.update(id, body ?? {});
  }
}
