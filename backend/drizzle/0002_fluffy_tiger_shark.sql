ALTER TABLE "client_groups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "client_groups" CASCADE;--> statement-breakpoint
DROP TABLE "clients" CASCADE;--> statement-breakpoint
CREATE INDEX "devices_device_token_id_idx" ON "devices" USING btree ("device_token_id");