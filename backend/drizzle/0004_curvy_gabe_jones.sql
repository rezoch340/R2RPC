CREATE TABLE "device_daily_metrics" (
	"stat_date" date NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"project_name" varchar(128) NOT NULL,
	"total_requests" bigint DEFAULT 0 NOT NULL,
	"success_requests" bigint DEFAULT 0 NOT NULL,
	"failed_requests" bigint DEFAULT 0 NOT NULL,
	"timeout_requests" bigint DEFAULT 0 NOT NULL,
	"total_latency_ms" bigint DEFAULT 0 NOT NULL,
	"max_latency_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_daily_metrics_stat_date_client_id_project_name_pk" PRIMARY KEY("stat_date","client_id","project_name")
);
--> statement-breakpoint
CREATE TABLE "rpc_daily_metrics" (
	"stat_date" date NOT NULL,
	"project_name" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"client_id" varchar(128) DEFAULT '' NOT NULL,
	"total_requests" bigint DEFAULT 0 NOT NULL,
	"success_requests" bigint DEFAULT 0 NOT NULL,
	"failed_requests" bigint DEFAULT 0 NOT NULL,
	"timeout_requests" bigint DEFAULT 0 NOT NULL,
	"total_latency_ms" bigint DEFAULT 0 NOT NULL,
	"max_latency_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rpc_daily_metrics_stat_date_project_name_action_name_client_id_pk" PRIMARY KEY("stat_date","project_name","action_name","client_id")
);
--> statement-breakpoint
DROP TABLE "metrics" CASCADE;--> statement-breakpoint
CREATE INDEX "device_daily_project_date" ON "device_daily_metrics" USING btree ("project_name","stat_date");--> statement-breakpoint
CREATE INDEX "device_daily_client_date" ON "device_daily_metrics" USING btree ("client_id","stat_date");--> statement-breakpoint
CREATE INDEX "rpc_daily_project_date" ON "rpc_daily_metrics" USING btree ("project_name","stat_date");--> statement-breakpoint
CREATE INDEX "rpc_daily_action_date" ON "rpc_daily_metrics" USING btree ("action_name","stat_date");