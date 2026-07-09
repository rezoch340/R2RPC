import {
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// 指标聚合(按 project/action/时间桶)
export const metrics = pgTable('metrics', {
  id: serial('id').primaryKey(),
  projectName: varchar('project_name', { length: 128 }).notNull(),
  actionName: varchar('action_name', { length: 128 }).notNull(),
  bucket: timestamp('bucket', { withTimezone: true }).notNull(),
  total: integer('total').notNull().default(0),
  okCount: integer('ok_count').notNull().default(0),
  errCount: integer('err_count').notNull().default(0),
  description: varchar('description', { length: 255 }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
