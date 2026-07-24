import {
  boolean,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 管理员 / 调用方用户
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('admin'),
    isRoot: boolean('is_root').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_username_uq')
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
