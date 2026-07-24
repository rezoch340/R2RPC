CREATE TABLE "system_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" varchar(1024) NOT NULL,
	"actor_user_id" integer NOT NULL,
	"actor_username" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(128),
	"target_name" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"method" varchar(16) NOT NULL,
	"route" varchar(255) NOT NULL,
	"status" varchar(16) NOT NULL,
	"status_code" integer NOT NULL,
	"error_message" varchar(1024),
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_logs_created_id_idx" ON "system_logs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "system_logs_actor_created_idx" ON "system_logs" USING btree ("actor_username","created_at");--> statement-breakpoint
CREATE INDEX "system_logs_subject_action_created_idx" ON "system_logs" USING btree ("subject","action","created_at");--> statement-breakpoint
CREATE INDEX "system_logs_status_created_idx" ON "system_logs" USING btree ("status","created_at");