import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Tool, ToolLevels } from '@archova/domain/permissions';

export const access = pgSchema('access');

export const permissionTemplates = access.table('permission_templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  key: text('key'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  isSeeded: boolean('is_seeded').notNull(),
  toolLevels: jsonb('tool_levels').$type<ToolLevels>().notNull(),
  granular: text('granular').array().notNull(),
  companyScopedTools: text('company_scoped_tools').array().$type<Tool[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const projectMemberOverrides = access.table('project_member_overrides', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectMemberId: uuid('project_member_id').notNull(),
  permissionKey: text('permission_key').notNull(),
  effect: text('effect').$type<'grant' | 'deny'>().notNull(),
  grantedBy: uuid('granted_by'),
  reason: text('reason'),
});
