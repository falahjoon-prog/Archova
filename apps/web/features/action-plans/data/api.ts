import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import type { ActionPlan, ActionPlanDetail, PlanTemplate } from '../lib/types';
import type { ActionPlansSource } from './source';

type ApiPlan = components['schemas']['ActionPlan'];
type ApiDetail = components['schemas']['ActionPlanDetail'];
type ApiTemplate = components['schemas']['ActionPlanTemplate'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/action-plans' as const;
const T = '/v1/orgs/{orgId}/projects/{projectId}/action-plan-templates' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toPlan = (p: ApiPlan): ActionPlan => ({
  id: p.id,
  numberLabel: p.numberLabel,
  title: p.title,
  description: p.description,
  status: p.status,
  dueDate: p.dueDate,
  isOverdue: p.isOverdue,
  templateId: p.templateId,
  sourceType: p.sourceType,
  sourceId: p.sourceId,
  itemCount: p.itemCount,
  doneCount: p.doneCount,
  completedAt: p.completedAt,
  createdAt: p.createdAt,
  version: p.version,
});

export const toDetail = (d: ApiDetail): ActionPlanDetail => ({
  plan: toPlan(d.plan),
  canManage: d.canManage,
  items: d.items.map((i) => ({
    id: i.id,
    planId: i.planId,
    sort: i.sort,
    title: i.title,
    description: i.description,
    assigneeCompanyId: i.assigneeCompanyId,
    dueDate: i.dueDate,
    isOverdue: i.isOverdue,
    status: i.status,
    note: i.note,
    completedAt: i.completedAt,
    canUpdate: i.canUpdate,
  })),
});

const toTemplate = (t: ApiTemplate): PlanTemplate => ({
  id: t.id,
  name: t.name,
  description: t.description,
  items: t.items,
});

/** The live source. Reads the first 100 plans; the status filter is applied by the API. */
export function createActionPlansApi(orgId: string): ActionPlansSource {
  return {
    async list(projectId, f) {
      const r = unwrap(
        await api.GET(P, {
          params: { path: { orgId, projectId }, query: { status: f.status, limit: 100 } },
        }),
      );
      return r.data.map(toPlan);
    },
    async get(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${P}/{planId}`, { params: { path: { orgId, projectId, planId: id } } }),
        ),
      );
    },
    async create(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async update(projectId, d, patch) {
      return toDetail(
        unwrap(
          await api.PATCH(`${P}/{planId}`, {
            params: {
              path: { orgId, projectId, planId: d.plan.id },
              header: ifMatch(d.plan.version),
            },
            body: patch,
          }),
        ),
      );
    },
    async addStep(projectId, planId, input) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/{planId}/items`, {
            params: { path: { orgId, projectId, planId } },
            body: input,
          }),
        ),
      );
    },
    async updateStep(projectId, planId, itemId, patch) {
      return toDetail(
        unwrap(
          await api.PATCH(`${P}/{planId}/items/{itemId}`, {
            params: { path: { orgId, projectId, planId, itemId } },
            body: patch,
          }),
        ),
      );
    },
    async templates(projectId) {
      const r = unwrap(await api.GET(T, { params: { path: { orgId, projectId } } }));
      return r.data.map(toTemplate);
    },
    async saveAsTemplate(projectId, planId, name) {
      return toTemplate(
        unwrap(
          await api.POST(`${P}/{planId}/save-as-template`, {
            params: { path: { orgId, projectId, planId } },
            body: { name },
          }),
        ),
      );
    },
  };
}
