// Pre-task plans data source, mirroring `{p}/pretask-plans` (safety module).
// Preview: in-memory store with the same rules as the server (a closed plan is frozen, hazards need controls to close).

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  CrewMember,
  Hazard,
  Plan,
  PlanDetail,
  Insights,
  PlanInput,
  Suggestion,
  SwmsOption,
  Template,
  TemplateInput,
} from '../lib/types';

export interface PretaskSource {
  listPlans(projectId: string): Promise<Plan[]>;
  getPlan(projectId: string, id: string): Promise<PlanDetail>;
  createPlan(projectId: string, input: PlanInput): Promise<PlanDetail>;
  /** Replaces the hazards of an open plan nobody has signed. */
  setHazards(projectId: string, d: PlanDetail, hazards: Hazard[]): Promise<PlanDetail>;
  transition(projectId: string, d: PlanDetail, action: 'close' | 'reopen'): Promise<PlanDetail>;
  review(projectId: string, d: PlanDetail, note: string | null): Promise<PlanDetail>;
  addCrew(
    projectId: string,
    d: PlanDetail,
    people: { personName: string; companyId?: string }[],
  ): Promise<PlanDetail>;
  removeCrew(projectId: string, d: PlanDetail, crewId: string): Promise<PlanDetail>;
  /** Signs one person on; `image` is the drawn (or typed) signature rendered as a PNG. */
  sign(projectId: string, d: PlanDetail, crewId: string, image: Blob): Promise<PlanDetail>;
  clearSignature(projectId: string, d: PlanDetail, crewId: string): Promise<PlanDetail>;
  suggestions(projectId: string, opts: { planId?: string; swmsId?: string }): Promise<Suggestion[]>;
  /** A new open plan from an earlier one: same task, hazards and people, nobody signed. */
  copyPlan(projectId: string, d: PlanDetail): Promise<PlanDetail>;
  listTemplates(projectId: string): Promise<Template[]>;
  createTemplate(projectId: string, input: TemplateInput): Promise<Template>;
  setTemplateActive(projectId: string, t: Template, isActive: boolean): Promise<Template>;
  /** Null when the caller may not see insights (not a supervisor). */
  insights(projectId: string): Promise<Insights | null>;
  /** SWMS on the project a plan can link to. */
  listSwms(projectId: string): Promise<SwmsOption[]>;
}

interface Store {
  plans: PlanDetail[];
  templates: Template[];
  next: number;
}

const label = (n: number) => `PTP-${String(n).padStart(4, '0')}`;
const RANK = { low: 0, medium: 1, high: 2, extreme: 3 } as const;

export function closeBlockers(hazards: Hazard[], crew: CrewMember[]): string[] {
  const out: string[] = [];
  if (hazards.length === 0) out.push('List at least one hazard for this task.');
  for (const h of hazards) {
    if (h.controls.trim() === '') out.push(`Say how you will control "${h.hazard}".`);
    if (h.riskAfter === 'extreme')
      out.push(
        `"${h.hazard}" is still extreme risk after controls. Do not start until it is lower.`,
      );
    else if (RANK[h.riskAfter] > RANK[h.riskBefore])
      out.push(`"${h.hazard}" has a higher risk after controls than before. Check the ratings.`);
  }
  if (crew.length === 0) out.push('Add the people doing the task.');
  else {
    const unsigned = crew.filter((c) => !c.signedAt).length;
    if (unsigned > 0)
      out.push(
        `${unsigned} ${unsigned === 1 ? 'person has' : 'people have'} not signed on. Sign, or remove them.`,
      );
  }
  return out;
}

const seed = (): Store => ({
  next: 2,
  templates: [
    {
      id: 'ptt_0001',
      name: 'Edge protection install',
      taskTitle: 'Install edge protection',
      swmsId: null,
      hazards: [
        {
          hazard: 'Falls from the slab edge',
          riskBefore: 'high',
          controls: 'Edge protection checked before starting',
          riskAfter: 'low',
        },
      ],
      isActive: true,
      version: 1,
    },
  ],
  plans: [
    {
      plan: {
        id: 'ptk_0001',
        numberLabel: label(1),
        taskTitle: 'Install edge protection, level 3',
        workDate: '2026-11-19',
        location: 'Level 3',
        companyId: null,
        swmsId: null,
        supervisorName: 'Pat Foreman',
        hazards: [
          {
            hazard: 'Falls from the slab edge',
            riskBefore: 'high',
            controls: 'Edge protection checked before starting',
            riskAfter: 'low',
          },
        ],
        status: 'open',
        closedAt: null,
        reviewedAt: null,
        reviewNote: null,
        crewCount: 2,
        signedCount: 1,
        version: 1,
      },
      crew: [
        {
          id: 'ptw_0001',
          personName: 'Sam Carpenter',
          companyId: null,
          signedAt: '2026-11-19T21:05:00Z',
          signatureFileId: 'fil_0001',
          inductionStatus: 'current',
          swmsRead: null,
        },
        {
          id: 'ptw_0002',
          personName: 'Lee Rigger',
          companyId: null,
          signedAt: null,
          signatureFileId: null,
          inductionStatus: null,
          swmsRead: null,
        },
      ],
      swms: null,
      closeBlockers: ['1 person has not signed on. Sign, or remove them.'],
      warnings: [],
      events: [{ id: 'pte_0001', action: 'created', note: null, at: '2026-11-19T20:55:00Z' }],
      canEdit: true,
      canReview: true,
    },
  ],
});

const stores = projectStores<Store>(seed);
export const resetPretaskPreview = () => {
  stores.reset();
};

function settle(s: Store, d: PlanDetail, event?: { action: string; note?: string }): PlanDetail {
  const next: PlanDetail = {
    ...d,
    plan: {
      ...d.plan,
      crewCount: d.crew.length,
      signedCount: d.crew.filter((c) => c.signedAt).length,
      version: d.plan.version + 1,
    },
    closeBlockers: d.plan.status === 'closed' ? [] : closeBlockers(d.plan.hazards, d.crew),
    events: event
      ? [
          ...d.events,
          { id: mockId('pte'), action: event.action, note: event.note ?? null, at: nowIso() },
        ]
      : d.events,
  };
  s.plans = s.plans.map((p) => (p.plan.id === d.plan.id ? next : p));
  return next;
}

function current(s: Store, id: string) {
  const d = s.plans.find((p) => p.plan.id === id);
  if (!d) problem(404, 'pretask.not_found', 'Pre-task plan not found.');
  return d;
}

function open(s: Store, id: string) {
  const d = current(s, id);
  if (d.plan.status === 'closed') problem(409, 'pretask.closed', 'This plan is closed.');
  return structuredClone(d);
}

const newCrew = (p: { personName: string; companyId?: string }): CrewMember => ({
  id: mockId('ptw'),
  personName: p.personName.trim(),
  companyId: p.companyId ?? null,
  signedAt: null,
  signatureFileId: null,
  inductionStatus: null,
  swmsRead: null,
});

export const pretaskPreview: PretaskSource = {
  async listPlans(projectId) {
    return delay(stores.get(projectId).plans.map((p) => p.plan));
  },
  async getPlan(projectId, id) {
    return delay(current(stores.get(projectId), id));
  },
  async createPlan(projectId, input) {
    const s = stores.get(projectId);
    const d: PlanDetail = {
      plan: {
        id: mockId('ptk'),
        numberLabel: label(s.next),
        taskTitle: input.taskTitle,
        workDate: input.workDate,
        location: input.location ?? null,
        companyId: input.companyId ?? null,
        swmsId: input.swmsId ?? null,
        supervisorName: input.supervisorName,
        hazards: input.hazards,
        status: 'open',
        closedAt: null,
        reviewedAt: null,
        reviewNote: null,
        crewCount: 0,
        signedCount: 0,
        version: 0,
      },
      crew: input.crew.map(newCrew),
      swms: null,
      closeBlockers: [],
      warnings: [],
      events: [],
      canEdit: true,
      canReview: true,
    };
    s.next += 1;
    s.plans = [d, ...s.plans];
    return delay(settle(s, d, { action: 'created' }));
  },
  async setHazards(projectId, d, hazards) {
    const s = stores.get(projectId);
    const cur = open(s, d.plan.id);
    if (cur.crew.some((c) => c.signedAt))
      problem(409, 'pretask.has_signatures', 'Clear the signatures first.');
    cur.plan.hazards = hazards;
    return delay(settle(s, cur, { action: 'hazards_updated', note: `${hazards.length} hazards` }));
  },
  async transition(projectId, d, action) {
    const s = stores.get(projectId);
    const cur = structuredClone(current(s, d.plan.id));
    if (action === 'close') {
      const blockers = closeBlockers(cur.plan.hazards, cur.crew);
      if (blockers.length) problem(422, 'pretask.cannot_close', blockers[0]!);
      cur.plan.status = 'closed';
      cur.plan.closedAt = nowIso();
      return delay(settle(s, cur, { action: 'closed' }));
    }
    cur.plan.status = 'open';
    cur.plan.closedAt = null;
    cur.plan.reviewedAt = null;
    cur.plan.reviewNote = null;
    return delay(settle(s, cur, { action: 'reopened' }));
  },
  async review(projectId, d, note) {
    const s = stores.get(projectId);
    const cur = structuredClone(current(s, d.plan.id));
    if (cur.plan.status !== 'closed') problem(409, 'pretask.not_closed', 'Close the plan first.');
    if (cur.plan.reviewedAt) problem(409, 'pretask.already_reviewed', 'Already reviewed.');
    cur.plan.reviewedAt = nowIso();
    cur.plan.reviewNote = note?.trim() ? note.trim() : null;
    return delay(
      settle(s, cur, {
        action: 'reviewed',
        ...(cur.plan.reviewNote ? { note: cur.plan.reviewNote } : {}),
      }),
    );
  },
  async addCrew(projectId, d, people) {
    const s = stores.get(projectId);
    const cur = open(s, d.plan.id);
    for (const p of people) {
      if (cur.crew.some((c) => c.personName.toLowerCase() === p.personName.trim().toLowerCase()))
        problem(409, 'pretask.already_listed', `${p.personName} is already on this plan.`);
      cur.crew.push(newCrew(p));
    }
    return delay(settle(s, cur, { action: 'crew_added' }));
  },
  async removeCrew(projectId, d, crewId) {
    const s = stores.get(projectId);
    const cur = open(s, d.plan.id);
    if (cur.crew.find((c) => c.id === crewId)?.signedAt)
      problem(409, 'pretask.has_signatures', 'Clear the signature first.');
    cur.crew = cur.crew.filter((c) => c.id !== crewId);
    return delay(settle(s, cur, { action: 'crew_removed' }));
  },
  async sign(projectId, d, crewId) {
    const s = stores.get(projectId);
    const cur = open(s, d.plan.id);
    const c = cur.crew.find((x) => x.id === crewId);
    if (!c) problem(404, 'pretask.crew_not_found', 'Person not found.');
    if (c.signedAt) problem(409, 'pretask.already_signed', 'Already signed.');
    c.signedAt = nowIso();
    c.signatureFileId = mockId('fil');
    c.inductionStatus = 'unknown';
    return delay(settle(s, cur, { action: 'signed', note: c.personName }));
  },
  async clearSignature(projectId, d, crewId) {
    const s = stores.get(projectId);
    const cur = open(s, d.plan.id);
    const c = cur.crew.find((x) => x.id === crewId);
    if (!c?.signedAt) problem(409, 'pretask.not_signed', 'Not signed.');
    c.signedAt = null;
    c.signatureFileId = null;
    c.inductionStatus = null;
    return delay(settle(s, cur, { action: 'signature_cleared', note: c.personName }));
  },
  async copyPlan(projectId, d) {
    return pretaskPreview.createPlan(projectId, {
      taskTitle: d.plan.taskTitle,
      workDate: nowIso().slice(0, 10),
      supervisorName: d.plan.supervisorName,
      ...(d.plan.location ? { location: d.plan.location } : {}),
      ...(d.plan.companyId ? { companyId: d.plan.companyId } : {}),
      ...(d.plan.swmsId ? { swmsId: d.plan.swmsId } : {}),
      hazards: d.plan.hazards,
      crew: d.crew.map((c) => ({
        personName: c.personName,
        ...(c.companyId ? { companyId: c.companyId } : {}),
      })),
    });
  },
  async listTemplates(projectId) {
    return delay(stores.get(projectId).templates);
  },
  async createTemplate(projectId, input) {
    const t: Template = {
      id: mockId('ptt'),
      name: input.name,
      taskTitle: input.taskTitle,
      swmsId: input.swmsId ?? null,
      hazards: input.hazards,
      isActive: true,
      version: 1,
    };
    stores.get(projectId).templates.push(t);
    return delay(t);
  },
  async setTemplateActive(projectId, t, isActive) {
    const cur = stores.get(projectId).templates.find((x) => x.id === t.id);
    if (!cur) problem(404, 'pretask.template_not_found', 'Template not found.');
    cur.isActive = isActive;
    cur.version += 1;
    return delay(cur);
  },
  async insights(projectId) {
    const plans = stores.get(projectId).plans;
    const by = new Map<string, { hazard: string; plans: number; high: number }>();
    for (const p of plans)
      for (const h of p.plan.hazards) {
        const e = by.get(h.hazard.toLowerCase()) ?? { hazard: h.hazard, plans: 0, high: 0 };
        e.plans += 1;
        if (h.riskBefore === 'high' || h.riskBefore === 'extreme') e.high += 1;
        by.set(h.hazard.toLowerCase(), e);
      }
    return delay({
      days: 30,
      plans: plans.length,
      closed: plans.filter((p) => p.plan.status === 'closed').length,
      reviewed: plans.filter((p) => p.plan.reviewedAt).length,
      toReview: plans.filter((p) => p.plan.status === 'closed' && !p.plan.reviewedAt).length,
      topHazards: [...by.values()]
        .sort((a, b) => b.plans - a.plans)
        .map((e) => ({
          hazard: e.hazard,
          plans: e.plans,
          highRiskPlans: e.high,
          lastSeen: nowIso().slice(0, 10),
          companyIds: [],
        })),
      byCompany: [{ companyId: null, plans: plans.length, closed: 0, highRiskHazards: 0 }],
    });
  },
  async listSwms() {
    return delay([
      { id: 'sws_0001', label: 'SWMS-0001 Edge protection install', status: 'accepted' },
    ]);
  },
  async suggestions(projectId, opts) {
    const s = stores.get(projectId);
    const have = new Set(
      (opts.planId ? (s.plans.find((p) => p.plan.id === opts.planId)?.plan.hazards ?? []) : []).map(
        (h) => h.hazard.toLowerCase(),
      ),
    );
    const counts = new Map<string, { n: number; h: Hazard }>();
    for (const p of s.plans)
      if (p.plan.id !== opts.planId)
        for (const h of p.plan.hazards) {
          const k = h.hazard.toLowerCase();
          counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, h });
        }
    return delay(
      [...counts.values()]
        .filter((c) => c.n >= 2 && !have.has(c.h.hazard.toLowerCase()))
        .map<Suggestion>((c) => ({
          reason: 'recurring',
          hazard: c.h.hazard,
          controls: c.h.controls,
          riskBefore: c.h.riskBefore,
          because: `Raised on ${c.n} plans in the last 14 days. Check the controls still hold.`,
        })),
    );
  },
};
