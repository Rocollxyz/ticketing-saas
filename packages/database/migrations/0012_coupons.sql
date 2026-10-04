CREATE TYPE "public"."coupon_kind" AS ENUM('PERCENT', 'AMOUNT');--> statement-breakpoint
CREATE TABLE "coupon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid,
	"code" text NOT NULL,
	"kind" "coupon_kind" NOT NULL,
	"value" integer NOT NULL,
	"ticket_type_ids" jsonb,
	"max_uses" integer,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "coupon_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon" ADD CONSTRAINT "coupon_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon" ADD CONSTRAINT "coupon_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_coupon_fk" FOREIGN KEY ("tenant_id","coupon_id") REFERENCES "public"."coupon"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Contar usos de un cupón (pedidos no cancelados).
CREATE INDEX "order_coupon_idx" ON "order" ("coupon_id") WHERE "coupon_id" IS NOT NULL;--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que 0001/0006/0011).
ALTER TABLE "coupon" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupon" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coupon"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
