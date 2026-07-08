import { integer, pgTable, primaryKey, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from '../users/users.schema';
import { groups } from '../groups/groups.schema';

// Access Token 表——用于 API 密钥式授权
export const accessTokens = pgTable('access_tokens', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(), // 明文可回看
  status: varchar('status', { length: 16 }).notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  description: varchar('description', { length: 255 }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Access Token 与分组的关联——多对多
export const accessTokenGroups = pgTable(
  'access_token_groups',
  {
    tokenId: integer('token_id')
      .notNull()
      .references(() => accessTokens.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.groupId] })],
);
