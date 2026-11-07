import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { TasksService } from '../application/tasks';
import { toMyTasks, toTask } from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const taskId = (p: { taskId: string }) => {
  const id = decodeId('task', p.taskId);
  if (!id) throw new AppError('task.not_found');
  return id;
};
const userId = (raw: string, path: string) => {
  const id = decodeId('user', raw);
  if (!id) throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return id;
};

export function tasksRoutes(database: Database, svc: TasksService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listMyTasks: async (input) => {
      const { rows, digest } = await read(input, (s) => svc.mine(s, input.query.status ?? 'open'));
      return { status: 200, body: toMyTasks(rows, digest) };
    },
    listProjectTasks: async (input) => {
      const { rows, names } = await read(input, (s) =>
        svc.list(s, project(input.params), {
          status: input.query.status ?? 'open',
          ...(input.query.assigneeId
            ? { assigneeId: userId(input.query.assigneeId, 'assigneeId') }
            : {}),
        }),
      );
      return { status: 200, body: { data: rows.map((r) => toTask(r, names)) } };
    },
    createTask: async (input) => {
      const { rows, names } = await tx(input, (s) =>
        svc.create(s, project(input.params), {
          ...input.body,
          assigneeId: input.body.assigneeId
            ? userId(input.body.assigneeId, 'assigneeId')
            : undefined,
        }),
      );
      return { status: 201, body: toTask(rows[0]!, names) };
    },
    updateTask: async (input) => {
      const { rows, names } = await tx(input, (s) =>
        svc.update(s, project(input.params), taskId(input.params), {
          ...input.body,
          assigneeId:
            input.body.assigneeId === undefined
              ? undefined
              : input.body.assigneeId === null
                ? null
                : userId(input.body.assigneeId, 'assigneeId'),
        }),
      );
      return { status: 200, body: toTask(rows[0]!, names) };
    },
  });
}
