ALTER TABLE "ticket_type" ADD COLUMN "seating" "seating_mode" DEFAULT 'RESERVED' NOT NULL;--> statement-breakpoint
-- Las categorías existentes heredan el modo de su evento (nada cambia de comportamiento).
UPDATE "ticket_type" tt SET "seating" = e."seating_mode" FROM "event" e WHERE e."id" = tt."event_id";
