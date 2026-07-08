import {
  boolean,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// 设备在线状态 / 指标脊柱
export const devices = pgTable('devices', {
  id: serial('id').primaryKey(),
  clientId: varchar('client_id', { length: 128 }).notNull().unique(),
  groupName: varchar('group_name', { length: 128 }),
  online: boolean('online').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});
