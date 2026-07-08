CREATE TABLE "access_token_groups" (
	"token_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"description" varchar(255),
	CONSTRAINT "access_token_groups_token_id_group_id_pk" PRIMARY KEY("token_id","group_id")
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
	CONSTRAINT "access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "access_token_id" integer;--> statement-breakpoint
ALTER TABLE "access_token_groups" ADD CONSTRAINT "access_token_groups_token_id_access_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token_groups" ADD CONSTRAINT "access_token_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;