import { defineModule, type KernelServices } from '@archova/kernel';
import { createTasksService, type TasksDeps } from './application/tasks';
import { tasksRoutes } from './api/routes';
import { TASKS_PERMISSIONS } from './permissions';

export type TasksModuleDeps = TasksDeps;

export function createTasksModule(services: KernelServices, deps: TasksModuleDeps) {
  const service = createTasksService(deps);
  return {
    definition: defineModule({ name: 'tasks', permissions: TASKS_PERMISSIONS }),
    routes: tasksRoutes(services.database, service),
    api: {},
  };
}

export type TasksModule = ReturnType<typeof createTasksModule>;
