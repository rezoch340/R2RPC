CREATE TABLE "device_token_projects" (
	"token_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "device_token_projects_token_id_project_id_pk" PRIMARY KEY("token_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
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
ALTER TABLE "devices" ADD COLUMN "device_token_id" integer;--> statement-breakpoint
ALTER TABLE "device_token_projects" ADD CONSTRAINT "device_token_projects_token_id_device_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."device_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_token_projects" ADD CONSTRAINT "device_token_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_uq" ON "device_tokens" USING btree ("token") WHERE "device_tokens"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_token_id_device_tokens_id_fk" FOREIGN KEY ("device_token_id") REFERENCES "public"."device_tokens"("id") ON DELETE no action ON UPDATE no action;