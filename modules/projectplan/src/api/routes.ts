import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ProjectPlanService } from '../application/plan';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const phase = (p: { phaseId: string }) => {
  const id = decodeId('planPhase', p.phaseId);
  if (!id) throw new AppError('project_plan.phase_not_found');
  return id;
};
const item = (p: { itemId: string }) => {
  const id = decodeId('planItem', p.itemId);
  if (!id) throw new AppError('project_plan.item_not_found');
  return id;
};
const request = (p: { requestId: string }) => {
  const id = decodeId('planRequest', p.requestId);
  if (!id) throw new AppError('project_plan.request_not_found');
  return id;
};

export function projectPlanRoutes(database: Database, plan: ProjectPlanService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    getProjectPlan: async (input) => ({
      status: 200,
      body: await read(input, (s) => plan.view(s, project(input.params))),
    }),
    startProjectPlan: async (input) => ({
      status: 201,
      body: await tx(input, (s) => plan.start(s, project(input.params))),
    }),
    getProjectPlanInsights: async (input) => ({
      status: 200,
      body: await read(input, (s) => plan.insights(s, project(input.params))),
    }),
    createPlanPhase: async (input) => ({
      status: 201,
      body: await tx(input, (s) => plan.createPhase(s, project(input.params), input.body.title)),
    }),
    updatePlanPhase: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        plan.updatePhase(s, project(input.params), phase(input.params), input.body),
      ),
    }),
    deletePlanPhase: async (input) => ({
      status: 200,
      body: await tx(input, (s) => plan.deletePhase(s, project(input.params), phase(input.params))),
    }),
    draftPlanPhaseSummary: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        plan.phaseSummary(s, project(input.params), phase(input.params)),
      ),
    }),
    createPlanItem: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        plan.createItem(s, project(input.params), phase(input.params), input.body),
      ),
    }),
    updatePlanItem: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        plan.updateItem(s, project(input.params), item(input.params), input.body),
      ),
    }),
    deletePlanItem: async (input) => ({
      status: 200,
      body: await tx(input, (s) => plan.deleteItem(s, project(input.params), item(input.params))),
    }),
    clearPlanHold: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        plan.clearHold(s, project(input.params), item(input.params), input.body.note),
      ),
    }),
    listPlanLinkOptions: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        plan.linkOptions(
          s,
          project(input.params),
          item(input.params),
          input.query.type,
          input.query.q ?? '',
        ),
      ),
    }),
    createPlanRequest: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        plan.createRequest(s, project(input.params), item(input.params), input.body),
      ),
    }),
    fulfilPlanRequest: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        plan.fulfilRequest(s, project(input.params), request(input.params), input.body.fileIds),
      ),
    }),
  });
}
