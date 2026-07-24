import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// 后台系统操作审计：不可变追加日志，不提供修改、删除或软删除入口。
export const systemLogs = pgTable(
  'system_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 1024 }).notNull(),
    actorUserId: integer('actor_user_id').notNull(),
    actorUsername: varchar('actor_username', { length: 64 }).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    subject: varchar('subject', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }),
    targetName: varchar('target_name', { length: 128 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    method: varchar('method', { length: 16 }).notNull(),
    route: varchar('route', { length: 255 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    statusCode: integer('status_code').notNull(),
    errorMessage: varchar('error_message', { length: 1024 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('system_logs_created_id_idx').on(table.createdAt, table.id),
    index('system_logs_actor_created_idx').on(
      table.actorUsername,
      table.createdAt,
    ),
    index('system_logs_subject_action_created_idx').on(
      table.subject,
      table.action,
      table.createdAt,
    ),
    index('system_logs_status_created_idx').on(table.status, table.createdAt),
  ],
);
