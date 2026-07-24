import {
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// 请求日志「取证脊柱」——只存标量/标识字段,不存大 payload 原文(原文进 Manticore)
export const requestLogs = pgTable(
  'request_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    projectName: varchar('project_name', { length: 128 }).notNull(),
    actionName: varchar('action_name', { length: 128 }).notNull(),
    clientId: varchar('client_id', { length: 128 }),
    requesterUserId: integer('requester_user_id'),
    accessTokenId: integer('access_token_id'),
    status: varchar('status', { length: 32 }).notNull(),
    httpCode: integer('http_code'),
    latencyMs: integer('latency_ms'),
    errorMessage: varchar('error_message', { length: 1024 }),
    // payload 写入状态: pending / indexed / failed / unavailable
    payloadState: varchar('payload_state', { length: 16 })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('req_logs_request_id_uq').on(table.requestId),
    index('req_logs_gac_created').on(
      table.projectName,
      table.actionName,
      table.clientId,
      table.createdAt,
    ),
    index('req_logs_gc_created').on(
      table.projectName,
      table.clientId,
      table.createdAt,
    ),
    index('req_logs_client_created').on(table.clientId, table.createdAt),
    index('req_logs_action_created').on(table.actionName, table.createdAt),
    index('req_logs_created_ga').on(
      table.createdAt,
      table.projectName,
      table.actionName,
    ),
    index('req_logs_status').on(table.status),
    index('req_logs_payload_state').on(table.payloadState),
  ],
);
