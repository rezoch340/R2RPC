ALTER TABLE "access_tokens" DROP CONSTRAINT "access_tokens_token_unique";--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_client_id_unique";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_client_id_unique";--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT "groups_name_unique";--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "perm_action_subject_uq";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_name_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "access_tokens_token_uq" ON "access_tokens" USING btree ("token") WHERE "access_tokens"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_client_id_uq" ON "clients" USING btree ("client_id") WHERE "clients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_client_id_uq" ON "devices" USING btree ("client_id") WHERE "devices"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_uq" ON "groups" USING btree ("name") WHERE "groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "perm_action_subject_uq" ON "permissions" USING btree ("action","subject") WHERE "permissions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_uq" ON "roles" USING btree ("name") WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username") WHERE "users"."deleted_at" IS NULL;