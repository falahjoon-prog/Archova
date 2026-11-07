// Action plans data source, mirroring `GET/POST {p}/action-plans`, `GET/PATCH {p}/action-plans/{id}`,
// `POST .../items`, `PATCH .../items/{id}`, `POST .../save-as-template` and `GET/POST {p}/action-plan-templates`
// (quality module). Preview: in-memory store with the server's completion rule.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  ActionPlan,
  ActionPlanDetail,
  ActionStep,
  PlanFilters,
  PlanInput,
  PlanPatch,
  PlanTemplate,
  StepInput,
  StepPatch,
} from '../lib/types';

export interface ActionPlansSource {
  list(projectId: string, filters: PlanFilters): Promise<ActionPlan[]>;
  get(projectId: string, id: string): Promise<ActionPlanDetail>;
  create(projectId: string, input: PlanInput): Promise<ActionPlanDetail>;
  update(projectId: string, d: ActionPlanDetail, patch: PlanPatch): Promise<ActionPlanDetail>;
  addStep(projectId: string, planId: string, input: StepInput): Promise<ActionPlanDetail>;
  updateStep(
    projectId: string,
    planId: string,
    stepId: string,
    patch: StepPatch,
  ): Promise<ActionPlanDetail>;
  templates(projectId: string): Promise<PlanTemplate[]>;
  saveAsTemplate(projectId: string, planId: string, name: string): Promise<PlanTemplate>;
}

interface Store {
  plans: { plan: ActionPlan; items: ActionStep[] }[];
  templates: PlanTemplate[];
  next: number;
}

const label = (n: number) => `AP-${String(n).padStart(4, '0')}`;

function step(
  planId: string,
  sort: number,
  over: Partial<ActionStep> & { title: string },
): ActionStep {
  return {
    id: `ali_${planId}_${sort}`,
    planId,
    sort,
    description: '',
    assigneeCompanyId: null,
    dueDate: null,
    isOverdue: false,
    status: 'open',
    note: null,
    completedAt: null,
    canUpdate: true,
    ...over,
  };
}

/** Recomputes the counts and, as the server does, completes or reactivates the plan. */
function settle(entry: Store['plans'][number]) {
  const { plan, items } = entry;
  plan.itemCount = items.length;
  plan.doneCount = items.filter((i) => i.status !== 'open').length;
  if (plan.status !== 'cancelled')
    plan.status = items.length > 0 && plan.doneCount === items.length ? 'completed' : 'active';
  plan.completedAt = plan.status === 'completed' ? (plan.completedAt ?? nowIso()) : null;
  plan.version += 1;
}

const stores = projectStores<Store>(() => {
  const a = step('apl_0001', 1, { title: 'Order edge protection', status: 'done' });
  const b = step('apl_0001', 2, {
    title: 'Install edge protection',
    dueDate: '2026-10-01',
    isOverdue: true,
  });
  const c = step('apl_0001', 3, { title: 'Builder sign-off' });
  const plan1: ActionPlan = {
    id: 'apl_0001',
    numberLabel: label(1),
    title: 'Level 2 edge protection',
    description: 'Close out the unprotected edge raised on the level 2 slab.',
    status: 'active',
    dueDate: '2026-10-05',
    isOverdue: true,
    templateId: null,
    sourceType: 'observation',
    sourceId: 'obs_0001',
    itemCount: 3,
    doneCount: 1,
    completedAt: null,
    createdAt: '2026-09-28T01:00:00Z',
    version: 2,
  };
  const d = step('apl_0002', 1, {
    title: 'Re-seal ramp',
    status: 'done',
    completedAt: '2026-10-02T01:00:00Z',
  });
  const plan2: ActionPlan = {
    id: 'apl_0002',
    numberLabel: label(2),
    title: 'Basement ramp rectification',
    description: '',
    status: 'completed',
    dueDate: null,
    isOverdue: false,
    templateId: null,
    sourceType: null,
    sourceId: null,
    itemCount: 1,
    doneCount: 1,
    completedAt: '2026-10-02T01:00:00Z',
    createdAt: '2026-09-29T01:00:00Z',
    version: 3,
  };
  return {
    next: 3,
    plans: [
      { plan: plan2, items: [d] },
      { plan: plan1, items: [a, b, c] },
    ],
    templates: [
      {
        id: 'apt_0001',
        name: 'Pre-pour readiness',
        description: 'Steps before every slab pour.',
        items: [
          { title: 'Reo inspection signed', description: '', dueOffsetDays: 2 },
          { title: 'Concrete ordered', description: '', dueOffsetDays: 3 },
          { title: 'Pour permit issued', description: '', dueOffsetDays: null },
        ],
      },
    ],
  };
});

function find(projectId: string, id: string) {
  const hit = stores.get(projectId).plans.find((p) => p.plan.id === id);
  if (!hit) problem(404, 'action_plan.not_found', 'That action plan was not found.');
  return hit;
}
const detail = (e: Store['plans'][number]): ActionPlanDetail =>
  structuredClone({ plan: e.plan, items: e.items, canManage: true });

export const actionPlansPreview: ActionPlansSource = {
  list: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .plans.filter((p) => !f.status || p.plan.status === f.status)
        .map((p) => ({ ...p.plan })),
    ),
  get: (projectId, id) => delay(detail(find(projectId, id))),
  create: (projectId, input) => {
    const s = stores.get(projectId);
    const tpl = input.templateId ? s.templates.find((t) => t.id === input.templateId) : undefined;
    if (input.templateId && !tpl)
      problem(404, 'action_plan_template.not_found', 'That template was not found.');
    const id = mockId('apl');
    const steps: StepInput[] = tpl
      ? tpl.items.map((i) => ({ title: i.title, description: i.description }))
      : (input.items ?? []);
    const entry: Store['plans'][number] = {
      plan: {
        id,
        numberLabel: label(s.next++),
        title: input.title,
        description: input.description ?? tpl?.description ?? '',
        status: 'active',
        dueDate: input.dueDate ?? null,
        isOverdue: false,
        templateId: input.templateId ?? null,
        sourceType: null,
        sourceId: null,
        itemCount: steps.length,
        doneCount: 0,
        completedAt: null,
        createdAt: nowIso(),
        version: 1,
      },
      items: steps.map((x, n) =>
        step(id, n + 1, {
          id: mockId('ali'),
          title: x.title,
          description: x.description ?? '',
          assigneeCompanyId: x.assigneeCompanyId ?? null,
          dueDate: x.dueDate ?? null,
        }),
      ),
    };
    s.plans.unshift(entry);
    return delay(detail(entry));
  },
  update: (projectId, d, patch) => {
    const e = find(projectId, d.plan.id);
    if (e.plan.status === 'cancelled' && patch.status === undefined)
      problem(409, 'action_plan.cancelled', 'Reopen the plan before changing it.');
    Object.assign(e.plan, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    });
    if (patch.status === 'cancelled') e.plan.status = 'cancelled';
    if (patch.status === 'active') e.plan.status = 'active';
    settle(e);
    return delay(detail(e));
  },
  addStep: (projectId, planId, input) => {
    const e = find(projectId, planId);
    if (e.plan.status === 'cancelled')
      problem(409, 'action_plan.cancelled', 'Reopen the plan before adding steps.');
    e.items.push(
      step(planId, (e.items.at(-1)?.sort ?? 0) + 1, {
        id: mockId('ali'),
        title: input.title,
        description: input.description ?? '',
        assigneeCompanyId: input.assigneeCompanyId ?? null,
        dueDate: input.dueDate ?? null,
      }),
    );
    settle(e);
    return delay(detail(e));
  },
  updateStep: (projectId, planId, stepId, patch) => {
    const e = find(projectId, planId);
    if (e.plan.status === 'cancelled')
      problem(409, 'action_plan.cancelled', 'This plan is cancelled.');
    const it = e.items.find((i) => i.id === stepId);
    if (!it) problem(404, 'action_plan.item_not_found', 'That step was not found.');
    Object.assign(it, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.assigneeCompanyId !== undefined
        ? { assigneeCompanyId: patch.assigneeCompanyId }
        : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    });
    if (patch.status !== undefined) {
      it.status = patch.status;
      it.completedAt = patch.status === 'open' ? null : nowIso();
      it.isOverdue = false;
    }
    settle(e);
    return delay(detail(e));
  },
  templates: (projectId) => delay(stores.get(projectId).templates),
  saveAsTemplate: (projectId, planId, name) => {
    const e = find(projectId, planId);
    const t: PlanTemplate = {
      id: mockId('apt'),
      name,
      description: e.plan.description,
      items: e.items.map((i) => ({
        title: i.title,
        description: i.description,
        dueOffsetDays: null,
      })),
    };
    stores.get(projectId).templates.push(t);
    return delay(t);
  },
};

export function resetActionPlansPreview() {
  stores.reset();
}
