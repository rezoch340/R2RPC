ALTER TABLE "devices" ADD COLUMN "status" varchar(16) DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "platform" varchar(64);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_ip" varchar(64);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "extra" text;