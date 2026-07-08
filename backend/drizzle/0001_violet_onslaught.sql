CREATE TABLE "client_groups" (
	"client_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	CONSTRAINT "client_groups_client_id_group_id_pk" PRIMARY KEY("client_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "group_name";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "group_name";