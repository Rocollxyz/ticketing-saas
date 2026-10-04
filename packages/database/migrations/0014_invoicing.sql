CREATE TYPE "public"."invoice_kind" AS ENUM('SIMPLIFIED', 'FULL', 'RECTIFYING');--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"aeat_type" text NOT NULL,
	"series" text NOT NULL,
	"number" integer NOT NULL,
	"full_number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_date" date,
	"rectifies_id" uuid,
	"replaces_id" uuid,
	"refund_id" uuid,
	"issuer" jsonb NOT NULL,
	"customer" jsonb,
	"lines" jsonb NOT NULL,
	"taxes" jsonb NOT NULL,
	"tax_name" text DEFAULT 'IVA' NOT NULL,
	"base_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"prev_hash" text,
	"record_hash" text NOT NULL,
	"recorded_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_number_uq" UNIQUE("tenant_id","series","number")
);
--> statement-breakpoint
CREATE TABLE "invoice_counter" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"last_hash" text,
	CONSTRAINT "invoice_counter_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "fiscal_name" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "fiscal_address" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "fiscal_postal_code" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "fiscal_city" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "fiscal_province" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "tax_regime" text DEFAULT 'IVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "tax_rate_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "tax_exempt_reason" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "billing" jsonb;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."order"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_counter" ADD CONSTRAINT "invoice_counter_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_order_kind_uq" ON "invoice" USING btree ("order_id","kind") WHERE kind <> 'RECTIFYING';--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_refund_uq" ON "invoice" USING btree ("refund_id") WHERE refund_id IS NOT NULL;--> statement-breakpoint
-- RLS: toda tabla con tenant_id nace aislada (mismo patrón que 0001/0006/0011+).
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invoice_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_counter"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);--> statement-breakpoint
-- Inalterabilidad (RD 1007/2023): una factura expedida no se modifica ni se borra; se
-- corrige con una rectificativa. La API (app_user) solo puede insertar y leer.
REVOKE UPDATE, DELETE ON "invoice" FROM app_user;
