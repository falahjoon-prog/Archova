// SWMS data source, mirroring `GET/POST {p}/swms`, `GET {p}/swms/{id}`, `POST {p}/swms/{id}/transition` and
// `POST {p}/swms/{id}/acknowledge` (safety module). Preview: in-memory store; the missing-content check is a
// simplified version of the server's.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import {
  needsReason,
  type Swms,
  type SwmsAction,
  type SwmsDetail,
  type SwmsEvent,
  type SwmsFilters,
  type SwmsGap,
  type SwmsInput,
  type SwmsTransition,
} from '../lib/types';

export interface SwmsSource {
  list(projectId: string, filters: SwmsFilters): Promise<Swms[]>;
  get(projectId: string, id: string): Promise<SwmsDetail>;
  create(projectId: string, input: SwmsInput): Promise<SwmsDetail>;
  transition(projectId: string, d: SwmsDetail, t: SwmsTransition): Promise<SwmsDetail>;
  acknowledge(projectId: string, d: SwmsDetail, workerName: string): Promise<SwmsDetail>;
}

interface Store {
  items: SwmsDetail[];
  next: number;
}

const label = (n: number) => `SWMS-${String(n).padStart(4, '0')}`;

function gapsFor(s: Swms): SwmsGap[] {
  const gaps: SwmsGap[] = [];
  if (!s.workDescription.trim()) {
    gaps.push({ item: 1, field: 'workDescription', message: 'Describe the high-risk work.' });
  }
  if (!s.hazardsAndRisks.trim()) {
    gaps.push({ item: 2, field: 'hazardsAndRisks', message: 'List the hazards and risks.' });
  }
  if (s.controlMeasures.length === 0) {
    gaps.push({ item: 3, field: 'controlMeasures', message: 'Describe the control measures.' });
  }
  if (!s.implementation.trim()) {
    gaps.push({
      item: 4,
      field: 'implementation',
      message: 'Say how the controls will be implemented.',
    });
  }
  if (!s.siteSpecific.trim()) {
    gaps.push({
      item: 5,
      field: 'siteSpecific',
      message: 'Describe the circumstances at this site.',
    });
  }
  return gaps;
}

const actionsFor = (s: SwmsDetail['swms']): SwmsAction[] =>
  s.status === 'submitted'
    ? ['markReviewed', 'reject']
    : s.status === 'reviewed'
      ? ['accept', 'reject']
      : ['reopen'];

function build(s: Swms, events: SwmsEvent[] = []): SwmsDetail {
  return {
    swms: s,
    events,
    acknowledgements: [],
    gaps: gapsFor(s),
    advisories: [],
    availableActions: actionsFor(s),
  };
}

const stores = projectStores<Store>(() => ({
  next: 3,
  items: [
    build({
      id: 'sws_0001',
      numberLabel: label(1),
      title: 'Working at heights, level 3 formwork',
      companyId: null,
      categories: ['fall_2m'],
      workDescription: 'Formwork erection to the level 3 slab edge.',
      hazardsAndRisks: 'Falls from the slab edge and from ladders; falling objects.',
      controlMeasures: [{ level: 'engineer', description: 'Edge protection and scaffold.' }],
      implementation: 'Supervisor checks controls each morning.',
      siteSpecific: 'Slab edge at level 3, north side.',
      revision: 1,
      status: 'submitted',
      expiresOn: null,
      isExpired: false,
      version: 1,
    }),
    build({
      id: 'sws_0002',
      numberLabel: label(2),
      title: 'Trench for stormwater line',
      companyId: null,
      categories: ['shaft_trench_tunnel'],
      workDescription: '',
      hazardsAndRisks: '',
      controlMeasures: [],
      implementation: '',
      siteSpecific: '',
      revision: 1,
      status: 'submitted',
      expiresOn: null,
      isExpired: false,
      version: 1,
    }),
  ],
}));

const find = (projectId: string, id: string) => {
  const hit = stores.get(projectId).items.find((x) => x.swms.id === id);
  if (!hit) problem(404, 'not_found', 'SWMS not found.');
  return hit;
};

export const swmsPreview: SwmsSource = {
  list: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .items.filter((d) => !f.status || d.swms.status === f.status)
        .map((d) => ({ ...d.swms })),
    ),
  get: (projectId, id) => delay(structuredClone(find(projectId, id))),
  create: (projectId, input) => {
    const s = stores.get(projectId);
    const d = build(
      {
        id: mockId('sws'),
        numberLabel: label(s.next++),
        title: input.title,
        companyId: input.companyId ?? null,
        categories: input.categories,
        workDescription: input.workDescription ?? '',
        hazardsAndRisks: input.hazardsAndRisks ?? '',
        controlMeasures: input.controlMeasures ?? [],
        implementation: input.implementation ?? '',
        siteSpecific: input.siteSpecific ?? '',
        revision: 1,
        status: 'submitted',
        expiresOn: input.expiresOn ?? null,
        isExpired: false,
        version: 1,
      },
      [
        {
          id: mockId('swe'),
          action: 'submit',
          toStatus: 'submitted',
          revision: 1,
          note: null,
          at: nowIso(),
        },
      ],
    );
    s.items.unshift(d);
    return delay(structuredClone(d));
  },
  transition: (projectId, d, t) => {
    const hit = find(projectId, d.swms.id);
    if (!hit.availableActions.includes(t.action)) {
      problem(409, 'swms.invalid_transition', 'That isn’t available for this SWMS.');
    }
    if (needsReason(t.action) && !t.reason?.trim()) {
      problem(422, 'validation.failed', 'A reason is required.');
    }
    if (t.action === 'accept') {
      if (hit.gaps.length > 0) problem(422, 'swms.incomplete', 'Required content is missing.');
      if (!t.confirmedUnderstandable) {
        problem(422, 'validation.failed', 'Confirm the SWMS is readily understandable.');
      }
    }
    const to: SwmsDetail['swms']['status'] =
      t.action === 'markReviewed'
        ? 'reviewed'
        : t.action === 'accept'
          ? 'accepted'
          : t.action === 'reject'
            ? 'rejected'
            : 'submitted';
    hit.events.push({
      id: mockId('swe'),
      action: t.action,
      toStatus: to,
      revision: hit.swms.revision,
      note: t.reason ?? null,
      at: nowIso(),
    });
    hit.swms.status = to;
    hit.swms.version += 1;
    hit.availableActions = actionsFor(hit.swms);
    return delay(structuredClone(hit));
  },
  acknowledge: (projectId, d, workerName) => {
    const hit = find(projectId, d.swms.id);
    if (hit.swms.status !== 'accepted') {
      problem(409, 'swms.not_accepted', 'Only an accepted SWMS can be acknowledged.');
    }
    hit.acknowledgements.push({ workerName, revision: hit.swms.revision, at: nowIso() });
    return delay(structuredClone(hit));
  },
};

export function resetSwmsPreview() {
  stores.reset();
}
