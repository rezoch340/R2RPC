import { integer, pgTable, primaryKey, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from '../users/users.schema';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  action: varchar('action', { length: 64 }).notNull(),
  subject: varchar('subject', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }),
}, (t) => [unique('perm_action_subject_uq').on(t.action, t.subject)]);
export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);
export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);
