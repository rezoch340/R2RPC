ALTER TABLE "client_groups" ADD COLUMN "description" varchar(255);--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "description" varchar(255);--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "description" varchar(255);