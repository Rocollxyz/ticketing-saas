CREATE TABLE "seatmap_feature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"pos_x" integer NOT NULL,
	"pos_y" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seatmap_feature_cell_uq" UNIQUE("event_id","pos_x","pos_y")
);
--> statement-breakpoint
ALTER TABLE "seatmap_feature" ADD CONSTRAINT "seatmap_feature_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seatmap_feature" ADD CONSTRAINT "seatmap_feature_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seatmap_feature" ADD CONSTRAINT "seatmap_feature_kind_chk" CHECK ("kind" IN ('gap', 'label'));--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que el resto).
ALTER TABLE "seatmap_feature" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seatmap_feature" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "seatmap_feature"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
