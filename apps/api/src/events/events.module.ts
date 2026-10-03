import { Module } from "@nestjs/common";
import { EventsController, VenuesController } from "./events.controller";
import { EventsService } from "./events.service";
import { TicketTypesService } from "./ticket-types.service";
import { VenuesService } from "./venues.service";

@Module({
  controllers: [EventsController, VenuesController],
  providers: [EventsService, TicketTypesService, VenuesService],
})
export class EventsModule {}
