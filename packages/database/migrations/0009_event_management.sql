CREATE TYPE "public"."event_visibility" AS ENUM('PUBLIC', 'UNLISTED');--> statement-breakpoint
CREATE TYPE "public"."seating_mode" AS ENUM('RESERVED', 'GENERAL');--> statement-breakpoint
ALTER TYPE "public"."event_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TABLE "seat" DROP CONSTRAINT "seat_ticket_type_fk";
--> statement-breakpoint
ALTER TABLE "hold_seat" DROP CONSTRAINT "hold_seat_seat_fk";
--> statement-breakpoint
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_seat_fk";
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "timezone" text DEFAULT 'Europe/Madrid' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "doors_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "visibility" "event_visibility" DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "seating_mode" "seating_mode" DEFAULT 'RESERVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "sales_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "sales_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "max_per_order" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "min_age" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "refund_policy" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "confirmation_message" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seat" ADD COLUMN "is_general" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "sales_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "sales_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "min_per_order" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "max_per_order" integer;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venue" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "venue" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "venue" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "venue" ADD COLUMN "country" text DEFAULT 'ES' NOT NULL;--> statement-breakpoint
ALTER TABLE "venue" ADD COLUMN "maps_url" text;--> statement-breakpoint
-- Los UNIQUE destino deben existir ANTES que las FKs que los referencian.
ALTER TABLE "seat" ADD CONSTRAINT "seat_event_id_uq" UNIQUE("tenant_id","event_id","id");--> statement-breakpoint
ALTER TABLE "ticket_type" ADD CONSTRAINT "ticket_type_event_id_uq" UNIQUE("tenant_id","event_id","id");--> statement-breakpoint
ALTER TABLE "seat" ADD CONSTRAINT "seat_ticket_type_fk" FOREIGN KEY ("tenant_id","event_id","ticket_type_id") REFERENCES "public"."ticket_type"("tenant_id","event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_seat" ADD CONSTRAINT "hold_seat_seat_fk" FOREIGN KEY ("tenant_id","event_id","seat_id") REFERENCES "public"."seat"("tenant_id","event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_seat_fk" FOREIGN KEY ("tenant_id","event_id","seat_id") REFERENCES "public"."seat"("tenant_id","event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
