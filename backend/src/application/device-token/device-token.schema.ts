import {
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../users/users.schema';
import { projects } from '../projects/projects.schema';

// Device Token 表——设备自注册上线凭证(明文进 SDK 配置)。
// 设备凭证长期有效，生命周期只由 active/revoked 与软删除控制。
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    token: varchar('token', { length: 128 }).notNull(), // 明文可回看
    status: varchar('status', { length: 16 }).notNull().default('active'),
    description: varchar('description', { length: 255 }),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('device_tokens_token_uq')
      .on(table.token)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// Device Token 与 project 的关联——多对多。设备上线继承该 token 勾定的 project(2c)。
export const deviceTokenProjects = pgTable(
  'device_token_projects',
  {
    tokenId: integer('token_id')
      .notNull()
      .references(() => deviceTokens.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.tokenId, table.projectId] })],
);
