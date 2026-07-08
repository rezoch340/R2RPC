import { integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { clients } from './client.schema';
import { groups } from '../groups/groups.schema';

// 设备 ↔ 设备组 多对多(设备多组)
export const clientGroups = pgTable(
  'client_groups',
  {
    clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.groupId] })],
);
