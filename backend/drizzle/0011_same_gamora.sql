ALTER TABLE "access_tokens" ADD COLUMN "monthly_usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "usage_period" varchar(7);--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_monthly_usage_count_ck" CHECK ("access_tokens"."monthly_usage_count" >= 0);