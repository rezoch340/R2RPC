import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deviceTokens } from '../device-token/device-token.schema';

// 设备在线状态 / 指标脊柱
export const devices = pgTable(
  'devices',
  {
    id: serial('id').primaryKey(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    deviceTokenId: integer('device_token_id').references(() => deviceTokens.id),
    online: boolean('online').notNull().default(false),
    description: varchar('description', { length: 255 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('devices_client_id_uq')
      .on(t.clientId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
