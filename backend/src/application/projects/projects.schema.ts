import {
  boolean,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 功能组(project,原 groups 改名)
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('projects_name_uq')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
