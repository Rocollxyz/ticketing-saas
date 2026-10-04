ALTER TABLE "tenant" ADD COLUMN "shop_theme" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_shop_theme_chk" CHECK ("shop_theme" IN ('light', 'dark'));
