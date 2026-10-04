CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'MANUAL', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_cents" bigint NOT NULL,
	"status" "refund_status" NOT NULL,
	"ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"provider_ref" text,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hold_seat" ADD COLUMN "price_cents" bigint;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "price_cents" bigint;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."order"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_order_idx" ON "refund" USING btree ("order_id");--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que 0001/0006/0011/0012).
ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refund" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "refund"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
