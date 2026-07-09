import { integer, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { clients } from './client.schema';
import { projects } from '../projects/projects.schema';

// 设备 ↔ 功能组 多对多(表名 client_groups + 列 group_id 保留,2c 随 client-login 一起删;此处仅 FK 指向改名后的 projects)
export const clientGroups = pgTable(
  'client_groups',
  {
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.groupId] })],
);
