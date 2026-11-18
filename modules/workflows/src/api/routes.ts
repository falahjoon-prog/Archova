import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { WorkflowsService } from '../application/workflows';

export function workflowsRoutes(database: Database, service: WorkflowsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const approvers = (steps: { name: string; approverUserIds: string[] }[]) =>
    steps.map((s) => ({
      name: s.name,
      approverUserIds: s.approverUserIds.map((u, i) => {
        const id = decodeId('user', u);
        if (!id)
          throw new AppError('validation_failed', 'Invalid user id', [
            { path: `steps/${i}/approverUserIds`, message: 'Invalid id' },
          ]);
        return id;
      }),
    }));
  const workflowId = (p: { workflowId: string }) => {
    const v = decodeId('workflow', p.workflowId);
    if (!v) throw new AppError('workflow.not_found');
    return v;
  };

  return defineRoutes({
    listWorkflows: async (input) => ({
      status: 200,
      body: await read(input, (s) => service.list(s)),
    }),
    createWorkflow: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        service.create(s, { ...input.body, steps: approvers(input.body.steps) }),
      ),
    }),
    updateWorkflow: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        service.update(s, workflowId(input.params), {
          ...input.body,
          ...(input.body.steps ? { steps: approvers(input.body.steps) } : {}),
        }),
      ),
    }),
    deleteWorkflow: async (input) => {
      await tx(input, (s) => service.remove(s, workflowId(input.params)));
      return { status: 204 };
    },
  });
}
