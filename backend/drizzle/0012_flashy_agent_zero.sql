ALTER TABLE "request_logs" ADD COLUMN "client_request_id" varchar(128);--> statement-breakpoint
CREATE INDEX "req_logs_client_request_id" ON "request_logs" USING btree ("client_request_id");