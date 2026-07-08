import { boolean, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

// 管理员 / 调用方用户
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 32 }).notNull().default('admin'),
  isRoot: boolean('is_root').notNull().default(false),
  description: varchar('description', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
