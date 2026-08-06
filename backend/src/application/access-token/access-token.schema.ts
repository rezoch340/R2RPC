import {
  check,
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
    maximumUsageCount: integer('maximum_usage_count'),
    usageCount: integer('usage_count').notNull().default(0),
    // 当月调用计数,只用于展示,不参与限流判断;usagePeriod 存 YYYY-MM(UTC),跨月懒清零
    monthlyUsageCount: integer('monthly_usage_count').notNull().default(0),
    usagePeriod: varchar('usage_period', { length: 7 }),
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
    check(
      'access_tokens_maximum_usage_count_ck',
      sql`${table.maximumUsageCount} IS NULL OR ${table.maximumUsageCount} > 0`,
    ),
    check('access_tokens_usage_count_ck', sql`${table.usageCount} >= 0`),
    check(
      'access_tokens_monthly_usage_count_ck',
      sql`${table.monthlyUsageCount} >= 0`,
    ),
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
