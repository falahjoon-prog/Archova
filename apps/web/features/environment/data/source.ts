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
  type MonitoringPoint,
  type PointInput,
  type Reading,
  type ReadingFilters,
  type ReadingInput,
  type ReadingStatus,
  type RespondInput,
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
  listPoints(projectId: string): Promise<MonitoringPoint[]>;
  createPoint(projectId: string, input: PointInput): Promise<MonitoringPoint>;
  logReading(projectId: string, point: MonitoringPoint, input: ReadingInput): Promise<Reading>;
  listReadings(projectId: string, filters: ReadingFilters): Promise<Reading[]>;
  respond(
    projectId: string,
    reading: Reading,
    input: RespondInput,
  ): Promise<{ reading: Reading; incidentNumber: number | null }>;
}

/** Today in the preview, fixed so the seeded dates stay overdue or current. */
const TODAY = '2026-11-07';

interface Store {
  conditions: Condition[];
  events: Record<string, ConditionEvent[]>;
  documents: EnvironmentDocument[];
  plan: Plan | null;
  points: Array<
    Omit<MonitoringPoint, 'latest' | 'recent' | 'openBreaches' | 'isOverdue' | 'isTrending'>
  >;
  readings: Reading[];
  next: number;
}

/** Same rule as the API: breach outside the limits, warning in the margin near them. */
function judge(
  value: number,
  p: Pick<MonitoringPoint, 'minLimit' | 'maxLimit' | 'warnMargin'>,
): ReadingStatus {
  const { minLimit: lo, maxLimit: hi, warnMargin } = p;
  if ((hi !== null && value > hi) || (lo !== null && value < lo)) return 'breach';
  const band =
    lo !== null && hi !== null ? (hi - lo) * warnMargin : Math.abs(hi ?? lo ?? 0) * warnMargin;
  if ((hi !== null && value >= hi - band) || (lo !== null && value <= lo + band)) return 'warning';
  return 'ok';
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
  points: [
    {
      id: 'mpt_0001',
      name: 'Dust monitor, north boundary',
      parameter: 'dust_pm10',
      unit: 'µg/m³',
      location: 'North hoarding',
      minLimit: null,
      maxLimit: 50,
      warnMargin: 0.2,
      frequency: 'daily',
      conditionId: 'emc_0001',
      active: true,
      version: 1,
    },
    {
      id: 'mpt_0002',
      name: 'Noise logger, Smith St',
      parameter: 'noise_laeq',
      unit: 'dB(A)',
      location: 'Smith St frontage',
      minLimit: null,
      maxLimit: 75,
      warnMargin: 0.2,
      frequency: 'daily',
      conditionId: 'emc_0003',
      active: true,
      version: 1,
    },
  ],
  readings: [
    ...[38, 41, 44, 52].map((value, i) => ({
      id: `erd_000${i + 1}`,
      pointId: 'mpt_0001',
      pointName: 'Dust monitor, north boundary',
      unit: 'µg/m³',
      value,
      takenAt: `2026-11-0${i + 3}T22:00:00Z`,
      status: (value > 50 ? 'breach' : 'ok') as ReadingStatus,
      note: null,
      evidenceCount: 0,
      responseNote: null,
      respondedAt: null,
      incidentId: null,
    })),
    ...[68, 70, 71].map((value, i) => ({
      id: `erd_001${i}`,
      pointId: 'mpt_0002',
      pointName: 'Noise logger, Smith St',
      unit: 'dB(A)',
      value,
      takenAt: `2026-11-0${i + 5}T22:00:00Z`,
      status: 'warning' as ReadingStatus,
      note: null,
      evidenceCount: 0,
      responseNote: null,
      respondedAt: null,
      incidentId: null,
    })),
  ],
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

const withStats = (s: Store, p: Store['points'][number]): MonitoringPoint => {
  const own = s.readings
    .filter((r) => r.pointId === p.id)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const latest = own.at(-1) ?? null;
  const last3 = own.slice(-3).map((r) => r.value);
  return {
    ...p,
    latest: latest ? { ...latest } : null,
    recent: own.slice(-14).map((r) => r.value),
    openBreaches: own.filter((r) => r.status === 'breach' && !r.respondedAt).length,
    isOverdue: false,
    isTrending:
      p.maxLimit !== null &&
      last3.length === 3 &&
      last3[0]! < last3[1]! &&
      last3[1]! < last3[2]! &&
      latest?.status === 'warning',
  };
};

const flagsFor = (s: Store): Flag[] => {
  const flags: Flag[] = [];
  const openBreaches = s.readings.filter((r) => r.status === 'breach' && !r.respondedAt);
  if (openBreaches.length)
    flags.push({
      code: 'monitoring_breach_open',
      severity: 'critical',
      message: `${openBreaches.length} monitoring ${openBreaches.length === 1 ? 'breach is' : 'breaches are'} waiting for a corrective-action response.`,
    });
  const rising = s.points.map((p) => withStats(s, p)).filter((p) => p.isTrending);
  if (rising.length)
    flags.push({
      code: 'monitoring_trending',
      severity: 'warning',
      message: `${rising.map((p) => p.name).join(', ')} ${rising.length === 1 ? 'is' : 'are'} rising towards the limit. Act before it is breached.`,
    });
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
      monitoring: {
        points: s.points.filter((p) => p.active).length,
        openBreaches: s.readings.filter((r) => r.status === 'breach' && !r.respondedAt).length,
        overdue: 0,
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
  listPoints: (projectId) => {
    const s = stores.get(projectId);
    return delay(s.points.map((p) => withStats(s, p)));
  },
  createPoint: (projectId, input) => {
    const s = stores.get(projectId);
    if ((input.minLimit ?? null) === null && (input.maxLimit ?? null) === null)
      problem(422, 'validation.failed', 'Set at least one limit.');
    const p = {
      id: mockId('mpt'),
      name: input.name,
      parameter: input.parameter,
      unit: input.unit,
      location: input.location ?? null,
      minLimit: input.minLimit ?? null,
      maxLimit: input.maxLimit ?? null,
      warnMargin: 0.2,
      frequency: input.frequency ?? ('daily' as const),
      conditionId: input.conditionId ?? null,
      active: true,
      version: 1,
    };
    s.points.push(p);
    return delay(withStats(s, p));
  },
  logReading: (projectId, point, input) => {
    const s = stores.get(projectId);
    const r: Reading = {
      id: mockId('erd'),
      pointId: point.id,
      pointName: point.name,
      unit: point.unit,
      value: input.value,
      takenAt: nowIso(),
      status: judge(input.value, point),
      note: input.note?.trim() || null,
      evidenceCount: input.files?.length ?? 0,
      responseNote: null,
      respondedAt: null,
      incidentId: null,
    };
    s.readings.push(r);
    if (r.status === 'breach' && point.conditionId) {
      const c = s.conditions.find((x) => x.id === point.conditionId);
      if (c && c.status !== 'non_compliant' && c.status !== 'not_applicable') {
        c.status = 'non_compliant';
        c.availableActions = actionsFor(c);
        c.version += 1;
      }
    }
    return delay({ ...r });
  },
  listReadings: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .readings.filter(
          (r) =>
            (f.status === undefined || r.status === f.status) &&
            (f.open === undefined || (f.open ? !r.respondedAt : !!r.respondedAt)),
        )
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
        .map((r) => ({ ...r })),
    ),
  respond: (projectId, reading, input) => {
    const hit = stores.get(projectId).readings.find((r) => r.id === reading.id);
    if (!hit) problem(404, 'environment.reading_not_found', 'That reading was not found.');
    if (hit!.status !== 'breach' || hit!.respondedAt)
      problem(409, 'conflict', 'This reading has nothing left to answer.');
    hit!.responseNote = input.note;
    hit!.respondedAt = nowIso();
    if (input.raiseIncident) hit!.incidentId = mockId('inx');
    return delay({ reading: { ...hit! }, incidentNumber: input.raiseIncident ? 12 : null });
  },
};

export function resetEnvironmentPreview() {
  stores.reset();
}
