import { pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

// 手机设备账号(用于 /api/client/login)
export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  clientId: varchar('client_id', { length: 128 }).notNull().unique(),
  groupName: varchar('group_name', { length: 128 }).notNull(),
  secretHash: varchar('secret_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
