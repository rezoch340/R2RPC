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

// Access Token 表——用于 API 密钥式授权
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    token: varchar('token', { length: 128 }).notNull(), // 明文可回看
    status: varchar('status', { length: 16 }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    description: varchar('description', { length: 255 }),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('access_tokens_token_uq')
      .on(table.token)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// Access Token 与 project 的关联——多对多
export const accessTokenProjects = pgTable(
  'access_token_projects',
  {
    tokenId: integer('token_id')
      .notNull()
      .references(() => accessTokens.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.tokenId, table.projectId] })],
);
