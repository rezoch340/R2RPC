CREATE TABLE "access_token_projects" (
	"token_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "access_token_projects_token_id_project_id_pk" PRIMARY KEY("token_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "access_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"token" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"description" varchar(255),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_groups" (
	"client_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "client_groups_client_id_group_id_pk" PRIMARY KEY("client_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"secret_hash" varchar(255) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"description" varchar(255),
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"err_count" integer DEFAULT 0 NOT NULL,
	"description" varchar(255),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(64) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"description" varchar(255),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"project_name" varchar(128) NOT NULL,
	"action_name" varchar(128) NOT NULL,
	"client_id" varchar(128),
	"requester_user_id" integer,
	"access_token_id" integer,
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
	"is_root" boolean DEFAULT false NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_token_projects" ADD CONSTRAINT "access_token_projects_token_id_access_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token_projects" ADD CONSTRAINT "access_token_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_group_id_projects_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_tokens_token_uq" ON "access_tokens" USING btree ("token") WHERE "access_tokens"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_client_id_uq" ON "clients" USING btree ("client_id") WHERE "clients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_client_id_uq" ON "devices" USING btree ("client_id") WHERE "devices"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_name_uq" ON "projects" USING btree ("name") WHERE "projects"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "perm_action_subject_uq" ON "permissions" USING btree ("action","subject") WHERE "permissions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_uq" ON "roles" USING btree ("name") WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "req_logs_request_id_uq" ON "request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "req_logs_gac_created" ON "request_logs" USING btree ("project_name","action_name","client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_gc_created" ON "request_logs" USING btree ("project_name","client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_client_created" ON "request_logs" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_action_created" ON "request_logs" USING btree ("action_name","created_at");--> statement-breakpoint
CREATE INDEX "req_logs_created_ga" ON "request_logs" USING btree ("created_at","project_name","action_name");--> statement-breakpoint
CREATE INDEX "req_logs_status" ON "request_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "req_logs_payload_state" ON "request_logs" USING btree ("payload_state");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username") WHERE "users"."deleted_at" IS NULL;