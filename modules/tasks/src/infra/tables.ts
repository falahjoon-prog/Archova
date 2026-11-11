import { date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { TaskPriority, TaskStatus } from '@archova/domain';

export const tasksSchema = pgSchema('tasks');

export const tasks = tasksSchema.table('tasks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  assigneeUserId: uuid('assignee_user_id'),
  dueDate: date('due_date'),
  priority: text('priority').$type<TaskPriority>().notNull().default('medium'),
  status: text('status').$type<TaskStatus>().notNull().default('open'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
