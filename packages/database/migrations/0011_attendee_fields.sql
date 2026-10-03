CREATE TYPE "public"."attendee_field_type" AS ENUM('text', 'textarea', 'email', 'phone', 'number', 'select', 'checkbox', 'date', 'dni');--> statement-breakpoint
CREATE TABLE "attendee_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"preset_key" text,
	"label" text NOT NULL,
	"type" "attendee_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"help_text" text,
	"options" jsonb,
	"ticket_type_ids" jsonb,
	"show_on_ticket" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hold_seat" ADD COLUMN "attendee" jsonb;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "attendee_name" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "attendee" jsonb;--> statement-breakpoint
ALTER TABLE "attendee_field" ADD CONSTRAINT "attendee_field_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendee_field" ADD CONSTRAINT "attendee_field_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que 0001/0006).
ALTER TABLE "attendee_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendee_field" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attendee_field"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
