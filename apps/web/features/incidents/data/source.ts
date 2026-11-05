// Incident data source, mirroring `GET/POST {p}/incidents`, `GET/PATCH {p}/incidents/{id}`, `POST .../transition`,
// `POST .../actions` and `PATCH .../actions/{id}` (safety module). Preview: in-memory store with the server's
// closing rules.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  ActionInput,
  ClassifyInput,
  CorrectiveAction,
  CorrectiveStatus,
  Incident,
  IncidentAction,
  IncidentDetail,
  IncidentFilters,
  ReportInput,
} from '../lib/types';
import { needsReason } from '../lib/types';

export interface IncidentSource {
  list(projectId: string, filters: IncidentFilters): Promise<Incident[]>;
  get(projectId: string, id: string): Promise<IncidentDetail>;
  report(projectId: string, input: ReportInput): Promise<IncidentDetail>;
  classify(projectId: string, d: IncidentDetail, input: ClassifyInput): Promise<IncidentDetail>;
  transition(
    projectId: string,
    d: IncidentDetail,
    t: { action: IncidentAction; reason?: string },
  ): Promise<IncidentDetail>;
  addAction(projectId: string, d: IncidentDetail, input: ActionInput): Promise<IncidentDetail>;
  setActionStatus(
    projectId: string,
    d: IncidentDetail,
    actionId: string,
    status: CorrectiveStatus,
  ): Promise<IncidentDetail>;
}

interface Store {
  items: IncidentDetail[];
  next: number;
}

const label = (n: number) => `INC-${String(n).padStart(4, '0')}`;
const HOUR = 3_600_000;

function blockers(d: IncidentDetail) {
  const i = d.incident;
  const out: { field: string; message: string }[] = [];
  if (!i.rootCause || !i.rootCause.summary.trim() || i.rootCause.causes.every((c) => !c.trim()))
    out.push({ field: 'rootCause', message: 'Record the root cause before closing.' });
  if (i.isNotifiable && !i.regulatorNotifiedAt)
    out.push({ field: 'regulatorNotifiedAt', message: 'Record when the regulator was notified.' });
  const open = d.actions.filter((a) => a.status !== 'verified').length;
  if (open > 0)
    out.push({
      field: 'actions',
      message: `${open} corrective ${open === 1 ? 'action is' : 'actions are'} not verified.`,
    });
  return out;
}

function refresh(d: IncidentDetail) {
  d.incident.openActions = d.actions.filter((a) => a.status !== 'verified').length;
  d.incident.writtenNoticeDueAt = d.incident.writtenNoticeRequestedAt
    ? new Date(Date.parse(d.incident.writtenNoticeRequestedAt) + 48 * HOUR).toISOString()
    : null;
  d.incident.keepUntil = d.incident.regulatorNotifiedAt
    ? new Date(Date.parse(d.incident.regulatorNotifiedAt) + 5 * 365.25 * 24 * HOUR).toISOString()
    : null;
  d.closeBlockers = blockers(d);
  d.incident.version += 1;
  return d;
}

function make(n: number, over: Partial<Incident>): IncidentDetail {
  return refresh({
    incident: {
      id: `inx_000${n}`,
      numberLabel: label(n),
      title: '',
      type: 'near_miss',
      severity: 'low',
      occurredAt: '2026-11-02T22:30:00.000Z',
      location: null,
      description: '',
      immediateActions: null,
      isNotifiable: false,
      notifiableClass: null,
      regulatorNotifiedAt: null,
      writtenNoticeRequestedAt: null,
      writtenNoticeDueAt: null,
      keepUntil: null,
      rootCause: null,
      status: 'reported',
      openActions: 0,
      version: 0,
      ...over,
    },
    people: [],
    injuryHidden: false,
    actions: [],
    events: [
      { id: mockId('ive'), action: 'report', toStatus: 'reported', note: null, at: nowIso() },
    ],
    closeBlockers: [],
    canManage: true,
  });
}

const stores = projectStores<Store>(() => ({
  next: 3,
  items: [
    make(1, {
      title: 'Plank dropped from level 2 scaffold',
      type: 'near_miss',
      severity: 'medium',
      location: 'North scaffold',
      description: 'A plank slid off the lift and landed in the exclusion zone. No one was below.',
    }),
    make(2, {
      title: 'Subcontractor cut hand on sheet metal',
      type: 'injury',
      severity: 'high',
      isNotifiable: true,
      notifiableClass: 'serious_injury_illness',
      description: 'Deep laceration treated at hospital.',
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.incident.id === id);
  if (!hit) problem(404, 'incident.not_found', 'Incident not found.');
  return hit;
};

export const incidentsPreview: IncidentSource = {
  list: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .items.filter(
          (d) =>
            (!f.status || d.incident.status === f.status) &&
            (!f.type || d.incident.type === f.type),
        )
        .map((d) => ({ ...d.incident })),
    ),
  get: (projectId, id) => delay(structuredClone(find(projectId, id))),
  report: (projectId, input) => {
    const s = stores.get(projectId);
    const d = make(s.next++, {
      title: input.title,
      type: input.type,
      occurredAt: input.occurredAt,
      location: input.location ?? null,
      description: input.description ?? '',
      immediateActions: input.immediateActions ?? null,
    });
    d.people = (input.people ?? []).map((p) => ({
      id: mockId('ipp'),
      personName: p.personName,
      companyId: p.companyId ?? null,
      role: p.role,
      injury: null,
    }));
    s.items.unshift(d);
    return delay(structuredClone(d));
  },
  classify: (projectId, d, input) => {
    const hit = find(projectId, d.incident.id);
    if (hit.incident.status === 'closed')
      problem(409, 'incident.closed', 'Reopen the incident before changing it.');
    if (input.isNotifiable && !input.notifiableClass)
      problem(422, 'validation_failed', 'Choose the notifiable class.');
    Object.assign(hit.incident, {
      severity: input.severity,
      isNotifiable: input.isNotifiable,
      notifiableClass: input.isNotifiable ? input.notifiableClass : null,
      regulatorNotifiedAt: input.regulatorNotifiedAt,
      writtenNoticeRequestedAt: input.writtenNoticeRequestedAt,
      rootCause: input.rootCause,
    });
    hit.events.push({
      id: mockId('ive'),
      action: 'update',
      toStatus: hit.incident.status,
      note: null,
      at: nowIso(),
    });
    return delay(structuredClone(refresh(hit)));
  },
  transition: (projectId, d, t) => {
    const hit = find(projectId, d.incident.id);
    const from = hit.incident.status;
    const to =
      t.action === 'investigate' && from === 'reported'
        ? 'investigating'
        : t.action === 'close' && from === 'investigating'
          ? 'closed'
          : t.action === 'reopen' && from === 'closed'
            ? 'investigating'
            : null;
    if (!to) problem(409, 'incident.invalid_transition', 'That isn’t available for this incident.');
    if (needsReason(t.action) && !t.reason?.trim())
      problem(422, 'incident.reason_required', 'Give a reason.');
    if (t.action === 'close' && hit.closeBlockers.length > 0)
      problem(422, 'incident.cannot_close', 'The incident is not ready to close.');
    hit.incident.status = to!;
    hit.events.push({
      id: mockId('ive'),
      action: t.action,
      toStatus: to!,
      note: t.reason ?? null,
      at: nowIso(),
    });
    return delay(structuredClone(refresh(hit)));
  },
  addAction: (projectId, d, input) => {
    const hit = find(projectId, d.incident.id);
    if (hit.incident.status === 'closed')
      problem(409, 'incident.closed', 'Reopen the incident before adding actions.');
    const a: CorrectiveAction = {
      id: mockId('iac'),
      number: hit.actions.length + 1,
      title: input.title,
      description: input.description ?? null,
      assigneeCompanyId: input.assigneeCompanyId ?? null,
      dueDate: input.dueDate ?? null,
      source: null,
      status: 'open',
      isOverdue: false,
      version: 1,
    };
    hit.actions.push(a);
    hit.events.push({
      id: mockId('ive'),
      action: 'action_added',
      toStatus: hit.incident.status,
      note: a.title,
      at: nowIso(),
    });
    return delay(structuredClone(refresh(hit)));
  },
  setActionStatus: (projectId, d, actionId, status) => {
    const hit = find(projectId, d.incident.id);
    const a = hit.actions.find((x) => x.id === actionId);
    if (!a) problem(404, 'incident.action_not_found', 'Action not found.');
    const ok =
      (a!.status === 'open' && status === 'done') ||
      (a!.status === 'done' && (status === 'verified' || status === 'open'));
    if (!ok) problem(409, 'incident.action_invalid_transition', 'That isn’t available.');
    a!.status = status;
    a!.version += 1;
    return delay(structuredClone(refresh(hit)));
  },
};

export function resetIncidentsPreview() {
  stores.reset();
}
