ALTER TABLE "access_tokens" ADD COLUMN "maximum_usage_count" integer;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_maximum_usage_count_ck" CHECK ("access_tokens"."maximum_usage_count" IS NULL OR "access_tokens"."maximum_usage_count" > 0);--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_usage_count_ck" CHECK ("access_tokens"."usage_count" >= 0);