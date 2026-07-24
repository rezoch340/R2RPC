import {
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../users/users.schema';

export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('roles_name_uq')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
export const permissions = pgTable(
  'permissions',
  {
    id: serial('id').primaryKey(),
    action: varchar('action', { length: 64 }).notNull(),
    subject: varchar('subject', { length: 64 }).notNull(),
    description: varchar('description', { length: 255 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('perm_action_subject_uq')
      .on(table.action, table.subject)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);
export const userRoles = pgTable(
  'user_roles',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);
