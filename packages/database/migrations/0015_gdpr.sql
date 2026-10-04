ALTER TABLE "tenant" ADD COLUMN "privacy_url" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "attendee_retention_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "anonymized_at" timestamp with time zone;