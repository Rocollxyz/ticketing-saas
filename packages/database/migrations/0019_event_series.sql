CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_series_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_series_fk" FOREIGN KEY ("tenant_id","series_id") REFERENCES "public"."event_series"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_series_idx" ON "event" USING btree ("series_id");--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que el resto).
ALTER TABLE "event_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_series"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
