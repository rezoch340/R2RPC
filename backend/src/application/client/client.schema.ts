import {
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 手机设备账号(组成员关系走 client_groups)
export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    secretHash: varchar('secret_hash', { length: 255 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('clients_client_id_uq')
      .on(t.clientId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
