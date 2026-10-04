CREATE TABLE "fare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"requirement" text,
	"kind" "coupon_kind" NOT NULL,
	"value" integer NOT NULL,
	"ticket_type_ids" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fare_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fare_event_id_uq" UNIQUE("tenant_id","event_id","id")
);
--> statement-breakpoint
ALTER TABLE "hold_seat" ADD COLUMN "fare_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "fare_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "fare_name" text;--> statement-breakpoint
ALTER TABLE "fare" ADD CONSTRAINT "fare_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare" ADD CONSTRAINT "fare_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_seat" ADD CONSTRAINT "hold_seat_fare_fk" FOREIGN KEY ("tenant_id","fare_id") REFERENCES "public"."fare"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_fare_fk" FOREIGN KEY ("tenant_id","fare_id") REFERENCES "public"."fare"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare" ADD CONSTRAINT "fare_value_ck" CHECK (("kind" = 'PERCENT' AND "value" BETWEEN 1 AND 100) OR ("kind" = 'AMOUNT' AND "value" > 0));--> statement-breakpoint
CREATE INDEX "fare_event_idx" ON "fare" USING btree ("event_id");--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que el resto).
ALTER TABLE "fare" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fare" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fare"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
