import { Module } from "@nestjs/common";
import { AttendeeFieldsService } from "./attendee-fields.service";
import { AttendeeFieldsController, EventsController, VenuesController } from "./events.controller";
import { EventsService } from "./events.service";
import { TicketTypesService } from "./ticket-types.service";
import { VenuesService } from "./venues.service";

@Module({
  controllers: [EventsController, AttendeeFieldsController, VenuesController],
  providers: [EventsService, TicketTypesService, VenuesService, AttendeeFieldsService],
})
export class EventsModule {}
