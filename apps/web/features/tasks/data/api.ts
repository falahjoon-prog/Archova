// "My tasks" and ad-hoc tasks against the tasks module's endpoints.

import { unwrap } from '@archova/api-client';
import type { MyTask, MyTasks, Task } from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

export type { MyTask, MyTasks, Task };
export type TaskPriority = Task['priority'];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createTasksApi(orgId: string) {
  return {
    mine: async (status: 'open' | 'done'): Promise<MyTasks> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/my-tasks', {
          params: { path: { orgId }, query: { status } },
        }),
      ),
    create: async (
      projectId: string,
      body: {
        title: string;
        assigneeId?: string;
        dueDate?: string;
        priority?: TaskPriority;
      },
    ): Promise<Task> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/tasks', {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    setStatus: async (
      projectId: string,
      taskId: string,
      status: 'open' | 'done' | 'cancelled',
    ): Promise<Task> => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/projects/{projectId}/tasks/{taskId}', {
          params: { path: { orgId, projectId, taskId } },
          body: { status },
        }),
      );
    },
  };
}
