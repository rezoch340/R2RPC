import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// 设备日聚合(对齐老系统 device_daily_metrics)。派生/日志型:无 description/deleted_at,硬清理。
export const deviceDailyMetrics = pgTable(
  'device_daily_metrics',
  {
    statDate: date('stat_date').notNull(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    projectName: varchar('project_name', { length: 128 }).notNull(),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
    successRequests: bigint('success_requests', { mode: 'number' }).notNull().default(0),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull().default(0),
    timeoutRequests: bigint('timeout_requests', { mode: 'number' }).notNull().default(0),
    totalLatencyMs: bigint('total_latency_ms', { mode: 'number' }).notNull().default(0),
    maxLatencyMs: integer('max_latency_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.statDate, t.clientId, t.projectName] }),
    index('device_daily_project_date').on(t.projectName, t.statDate),
    index('device_daily_client_date').on(t.clientId, t.statDate),
  ],
);

// RPC 日聚合(对齐老系统 rpc_daily_metrics)。client_id 用 '' 表示无设备(不用 NULL,进复合 PK)。
export const rpcDailyMetrics = pgTable(
  'rpc_daily_metrics',
  {
    statDate: date('stat_date').notNull(),
    projectName: varchar('project_name', { length: 128 }).notNull(),
    actionName: varchar('action_name', { length: 128 }).notNull(),
    clientId: varchar('client_id', { length: 128 }).notNull().default(''),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
    successRequests: bigint('success_requests', { mode: 'number' }).notNull().default(0),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull().default(0),
    timeoutRequests: bigint('timeout_requests', { mode: 'number' }).notNull().default(0),
    totalLatencyMs: bigint('total_latency_ms', { mode: 'number' }).notNull().default(0),
    maxLatencyMs: integer('max_latency_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.statDate, t.projectName, t.actionName, t.clientId] }),
    index('rpc_daily_project_date').on(t.projectName, t.statDate),
    index('rpc_daily_action_date').on(t.actionName, t.statDate),
  ],
);
