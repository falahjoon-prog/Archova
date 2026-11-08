// Environmental register data source, mirroring `{p}/environment/*` (environment module). Preview: in-memory
// store; evidence files are counted, not kept.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import {
  needsNote,
  type Condition,
  type ConditionAction,
  type ConditionDetail,
  type ConditionEvent,
  type ConditionFilters,
  type ConditionInput,
  type ConditionStatus,
  type DocumentInput,
  type EnvironmentDocument,
  type Flag,
  type Plan,
  type PlanInput,
  type Summary,
  type TransitionInput,
} from '../lib/types';

export interface EnvironmentSource {
  summary(projectId: string): Promise<Summary>;
  listConditions(projectId: string, filters: ConditionFilters): Promise<Condition[]>;
  getCondition(projectId: string, id: string): Promise<ConditionDetail>;
  createCondition(projectId: string, input: ConditionInput): Promise<Condition>;
  applyStarterPack(projectId: string): Promise<{ created: number; skipped: number }>;
  transition(projectId: string, c: Condition, t: TransitionInput): Promise<Condition>;
  listDocuments(projectId: string): Promise<EnvironmentDocument[]>;
  createDocument(projectId: string, input: DocumentInput): Promise<EnvironmentDocument>;
  deleteDocument(projectId: string, d: EnvironmentDocument): Promise<void>;
  createPlan(projectId: string, input: PlanInput): Promise<Plan>;
  approvePlan(projectId: string, plan: Plan): Promise<Plan>;
}

/** Today in the preview, fixed so the seeded dates stay overdue or current. */
const TODAY = '2026-11-07';

interface Store {
  conditions: Condition[];
  events: Record<string, ConditionEvent[]>;
  documents: EnvironmentDocument[];
  plan: Plan | null;
  next: number;
}

const label = (n: number) => `EMC-${String(n).padStart(4, '0')}`;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const INTERVAL: Partial<Record<Condition['frequency'], number>> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
};

function actionsFor(c: Pick<Condition, 'status' | 'frequency'>): ConditionAction[] {
  switch (c.status) {
    case 'not_started':
      return ['start', 'signOff', 'flagNonCompliant', 'markNotApplicable'];
    case 'in_progress':
      return ['signOff', 'flagNonCompliant', 'markNotApplicable'];
    case 'non_compliant':
      return ['signOff', 'markNotApplicable'];
    case 'compliant':
      return [
        ...(INTERVAL[c.frequency] ? (['signOff'] as const) : []),
        'flagNonCompliant',
        'markNotApplicable',
        'reopen',
      ];
    default:
      return ['reopen'];
  }
}

const make = (n: number, over: Partial<Condition>): Condition => {
  const c: Condition = {
    id: `emc_000${n}`,
    numberLabel: label(n),
    title: '',
    requirement: null,
    category: 'other',
    source: 'cemp',
    sourceReference: null,
    frequency: 'once',
    responsibleCompanyId: null,
    status: 'not_started',
    dueDate: null,
    lastReviewedOn: null,
    isOverdue: false,
    evidenceCount: 0,
    availableActions: [],
    version: 1,
    ...over,
  };
  c.isOverdue = c.status !== 'not_applicable' && c.dueDate !== null && c.dueDate < TODAY;
  c.availableActions = actionsFor(c);
  return c;
};

const stores = projectStores<Store>(() => ({
  next: 5,
  plan: {
    title: 'Tower E Environmental Management Plan',
    permitReference: 'PL-2026-114',
    summary: 'Dust, noise and stormwater are the main risks on this inner-city site.',
    status: 'active',
    reviewIntervalMonths: 6,
    nextReviewDate: '2027-05-07',
    approvedAt: '2026-10-01T01:00:00Z',
    version: 2,
  },
  conditions: [
    make(1, {
      title: 'Dust suppression on haul roads',
      category: 'air_quality',
      source: 'planning_permit',
      sourceReference: 'Permit condition 14',
      frequency: 'daily',
      status: 'in_progress',
      dueDate: '2026-11-05',
    }),
    make(2, {
      title: 'Stormwater discharge meets licence limits',
      category: 'water_quality',
      source: 'epa_licence',
      frequency: 'per_event',
      status: 'non_compliant',
    }),
    make(3, {
      title: 'Construction hours and noise limits',
      category: 'noise_vibration',
      source: 'planning_permit',
      frequency: 'weekly',
      status: 'compliant',
      dueDate: '2026-11-14',
      lastReviewedOn: '2026-11-07',
      evidenceCount: 1,
    }),
    make(4, {
      title: 'Heritage unexpected-finds procedure briefed',
      category: 'heritage',
      source: 'planning_permit',
      status: 'not_started',
    }),
  ],
  events: {
    emc_0003: [
      {
        id: 'ev_1',
        action: 'sign_off',
        toStatus: 'compliant',
        note: 'Noise logger readings within limits.',
        evidenceCount: 1,
        at: '2026-11-07T01:00:00Z',
      },
    ],
  },
  documents: [
    {
      id: 'edc_0001',
      title: 'EPA works approval',
      docType: 'epa_licence',
      reference: 'EPA-80211',
      issuedOn: '2026-01-10',
      expiresOn: '2026-11-20',
      expiry: 'expiring',
      version: 1,
    },
  ],
}));

const flagsFor = (s: Store): Flag[] => {
  const flags: Flag[] = [];
  const bad = s.conditions.filter((c) => c.status === 'non_compliant');
  if (bad.length)
    flags.push({
      code: 'conditions_non_compliant',
      severity: 'critical',
      message: `${bad.length} ${bad.length === 1 ? 'condition' : 'conditions'} flagged non-compliant (${bad
        .map((c) => c.numberLabel)
        .join(', ')}). Close each out or record the corrective action.`,
    });
  const late = s.conditions.filter((c) => c.isOverdue && c.status !== 'non_compliant');
  if (late.length)
    flags.push({
      code: 'conditions_overdue',
      severity: 'warning',
      message: `${late.length} ${late.length === 1 ? 'sign-off' : 'sign-offs'} overdue. Sign them off with evidence or raise a non-compliance.`,
    });
  const soon = s.documents.filter((d) => d.expiry === 'expiring');
  if (soon.length)
    flags.push({
      code: 'documents_expiring',
      severity: 'warning',
      message: `${soon.length} ${soon.length === 1 ? 'document expires' : 'documents expire'} within 30 days.`,
    });
  if (!s.plan)
    flags.push({
      code: 'plan_missing',
      severity: 'warning',
      message: 'No Environmental Management Plan is set up for this project yet.',
    });
  return flags;
};

function expiryOf(expiresOn: string | null): EnvironmentDocument['expiry'] {
  if (!expiresOn) return 'none';
  if (expiresOn < TODAY) return 'expired';
  return expiresOn <= addDays(TODAY, 30) ? 'expiring' : 'valid';
}

export const environmentPreview: EnvironmentSource = {
  summary: (projectId) => {
    const s = stores.get(projectId);
    const byStatus: Record<ConditionStatus, number> = {
      not_started: 0,
      in_progress: 0,
      compliant: 0,
      non_compliant: 0,
      not_applicable: 0,
    };
    for (const c of s.conditions) byStatus[c.status] += 1;
    const applicable = s.conditions.length - byStatus.not_applicable;
    const cats = new Map<Condition['category'], Summary['conditions']['byCategory'][number]>();
    for (const c of s.conditions) {
      const t = cats.get(c.category) ?? {
        category: c.category,
        total: 0,
        compliant: 0,
        nonCompliant: 0,
        overdue: 0,
      };
      t.total += 1;
      if (c.status === 'compliant') t.compliant += 1;
      if (c.status === 'non_compliant') t.nonCompliant += 1;
      if (c.isOverdue) t.overdue += 1;
      cats.set(c.category, t);
    }
    return delay({
      plan: s.plan ? { ...s.plan } : null,
      conditions: {
        total: s.conditions.length,
        byStatus,
        overdue: s.conditions.filter((c) => c.isOverdue).length,
        compliancePercent:
          applicable === 0 ? null : Math.round((byStatus.compliant / applicable) * 100),
        byCategory: [...cats.values()],
      },
      documents: {
        total: s.documents.length,
        expired: s.documents.filter((d) => d.expiry === 'expired').length,
        expiring: s.documents.filter((d) => d.expiry === 'expiring').length,
      },
      flags: flagsFor(s),
    });
  },
  listConditions: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .conditions.filter(
          (c) =>
            (!f.status || c.status === f.status) &&
            (!f.category || c.category === f.category) &&
            (f.overdue === undefined || c.isOverdue === f.overdue),
        )
        .map((c) => ({ ...c })),
    ),
  getCondition: (projectId, id) => {
    const s = stores.get(projectId);
    const c = s.conditions.find((x) => x.id === id);
    if (!c)
      problem(404, 'environment.condition_not_found', 'That condition is not on this project.');
    return delay({ condition: { ...c! }, events: [...(s.events[id] ?? [])] });
  },
  createCondition: (projectId, input) => {
    const s = stores.get(projectId);
    const c = make(s.next, {
      id: mockId('emc'),
      title: input.title,
      category: input.category,
      source: input.source ?? 'other',
      sourceReference: input.sourceReference ?? null,
      requirement: input.requirement ?? null,
      frequency: input.frequency ?? 'once',
      dueDate: input.dueDate ?? null,
    });
    s.next += 1;
    s.conditions.push(c);
    return delay({ ...c });
  },
  applyStarterPack: (projectId) => {
    const s = stores.get(projectId);
    const pack: Array<[string, Condition['category'], Condition['frequency']]> = [
      ['Sediment and erosion controls inspected', 'soil_erosion', 'weekly'],
      ['Waste classified, segregated and disposed to licensed facilities', 'waste', 'monthly'],
      ['Concrete washout and chemical storage', 'hazardous_materials', 'weekly'],
    ];
    let created = 0;
    for (const [title, category, frequency] of pack) {
      if (s.conditions.some((c) => c.title.toLowerCase() === title.toLowerCase())) continue;
      s.conditions.push(make(s.next, { id: mockId('emc'), title, category, frequency }));
      s.next += 1;
      created += 1;
    }
    return delay({ created, skipped: pack.length - created });
  },
  transition: (projectId, c, t) => {
    const s = stores.get(projectId);
    const hit = s.conditions.find((x) => x.id === c.id)!;
    if (!hit.availableActions.includes(t.action))
      problem(409, 'environment.invalid_transition', 'That isn’t available for this condition.');
    if (needsNote(t.action) && !t.note?.trim())
      problem(422, 'validation.failed', 'A reason is required.');
    const evidence = t.files?.length ?? 0;
    if (t.action === 'signOff' && !t.note?.trim() && evidence === 0 && hit.evidenceCount === 0)
      problem(422, 'validation.failed', 'Attach evidence or add a note to sign off.');
    const to: ConditionStatus =
      t.action === 'start'
        ? 'in_progress'
        : t.action === 'signOff'
          ? 'compliant'
          : t.action === 'flagNonCompliant'
            ? 'non_compliant'
            : t.action === 'markNotApplicable'
              ? 'not_applicable'
              : 'in_progress';
    hit.status = to;
    hit.evidenceCount += evidence;
    if (t.action === 'signOff') {
      hit.lastReviewedOn = TODAY;
      const days = INTERVAL[hit.frequency];
      hit.dueDate = days ? addDays(TODAY, days) : null;
    }
    hit.isOverdue = to !== 'not_applicable' && hit.dueDate !== null && hit.dueDate < TODAY;
    hit.availableActions = actionsFor(hit);
    hit.version += 1;
    (s.events[hit.id] ??= []).push({
      id: mockId('ev'),
      action:
        t.action === 'signOff'
          ? 'sign_off'
          : t.action === 'flagNonCompliant'
            ? 'flag_non_compliant'
            : t.action === 'markNotApplicable'
              ? 'not_applicable'
              : t.action,
      toStatus: to,
      note: t.note?.trim() || null,
      evidenceCount: evidence,
      at: nowIso(),
    });
    return delay({ ...hit });
  },
  listDocuments: (projectId) => delay(stores.get(projectId).documents.map((d) => ({ ...d }))),
  createDocument: (projectId, input) => {
    const d: EnvironmentDocument = {
      id: mockId('edc'),
      title: input.title,
      docType: input.docType,
      reference: input.reference ?? null,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      expiry: expiryOf(input.expiresOn ?? null),
      version: 1,
    };
    stores.get(projectId).documents.push(d);
    return delay({ ...d });
  },
  deleteDocument: (projectId, d) => {
    const s = stores.get(projectId);
    s.documents = s.documents.filter((x) => x.id !== d.id);
    return delay(undefined);
  },
  createPlan: (projectId, input) => {
    const s = stores.get(projectId);
    if (s.plan) problem(409, 'environment.plan_exists', 'This project already has a plan.');
    s.plan = {
      title: input.title,
      permitReference: input.permitReference ?? null,
      summary: input.summary ?? null,
      status: 'draft',
      reviewIntervalMonths: input.reviewIntervalMonths ?? 6,
      nextReviewDate: null,
      approvedAt: null,
      version: 1,
    };
    return delay({ ...s.plan });
  },
  approvePlan: (projectId) => {
    const s = stores.get(projectId);
    if (!s.plan) problem(404, 'environment.plan_not_found', 'There is no plan to approve.');
    s.plan = {
      ...s.plan!,
      status: 'active',
      approvedAt: nowIso(),
      nextReviewDate: addDays(TODAY, 30 * s.plan!.reviewIntervalMonths),
      version: s.plan!.version + 1,
    };
    return delay({ ...s.plan });
  },
};

export function resetEnvironmentPreview() {
  stores.reset();
}
