CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"group_name" varchar(128) NOT NULL,
	"secret_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"group_name" varchar(128),
	"online" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "devices_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_name" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"err_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"group_name" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"client_id" varchar(128),
	"requester_user_id" integer,
	"status" varchar(32) NOT NULL,
	"http_code" integer,
	"latency_ms" integer,
	"error_message" varchar(1024),
	"payload_state" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(32) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "req_logs_request_id_uq" ON "request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "req_logs_gac_created" ON "request_logs" USING btree ("group_name","action_name","client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_gc_created" ON "request_logs" USING btree ("group_name","client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_client_created" ON "request_logs" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_action_created" ON "request_logs" USING btree ("action_name","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_created_ga" ON "request_logs" USING btree ("created_at","group_name","action_name");--> statement-breakpoint
CREATE INDEX "req_logs_status" ON "request_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "req_logs_payload_state" ON "request_logs" USING btree ("payload_state");