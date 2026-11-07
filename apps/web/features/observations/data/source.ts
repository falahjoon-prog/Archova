// Observations data source, mirroring `GET/POST {p}/observations`, `PATCH {p}/observations/{id}` and
// `POST {p}/observations/{id}/transition` (quality module). Preview: in-memory store, no photos.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import {
  needsReason,
  type Observation,
  type ObservationAction,
  type ObservationFilters,
  type ObservationInput,
  type TransitionInput,
} from '../lib/types';

export interface ObservationsSource {
  list(projectId: string, filters: ObservationFilters): Promise<Observation[]>;
  create(projectId: string, input: ObservationInput): Promise<Observation>;
  transition(projectId: string, o: Observation, t: TransitionInput): Promise<Observation>;
}

interface Store {
  items: Observation[];
  next: number;
}

const label = (n: number) => `OBS-${String(n).padStart(4, '0')}`;
const actionsFor = (status: Observation['status']): ObservationAction[] =>
  status === 'open' ? ['resolve'] : status === 'resolved' ? ['close', 'reopen'] : ['reopen'];

const stores = projectStores<Store>(() => ({
  next: 4,
  items: [
    {
      id: 'obs_0001',
      numberLabel: label(1),
      type: 'safety',
      hazard: 'Unprotected edge',
      description: 'No edge protection on the level 2 slab, east side.',
      location: 'Level 2 east',
      priority: 'high',
      assigneeCompanyId: null,
      raisedByCompanyId: null,
      status: 'open',
      dueDate: '2026-10-01',
      isOverdue: true,
      swmsId: null,
      resolutionNote: null,
      availableActions: actionsFor('open'),
      createdAt: '2026-09-28T01:00:00Z',
      version: 1,
    },
    {
      id: 'obs_0002',
      numberLabel: label(2),
      type: 'quality',
      hazard: null,
      description: 'Concrete finish on the ramp is below spec.',
      location: 'Basement ramp',
      priority: 'medium',
      assigneeCompanyId: null,
      raisedByCompanyId: null,
      status: 'resolved',
      dueDate: null,
      isOverdue: false,
      swmsId: null,
      resolutionNote: 'Ground and re-sealed.',
      availableActions: actionsFor('resolved'),
      createdAt: '2026-09-29T01:00:00Z',
      version: 2,
    },
    {
      id: 'obs_0003',
      numberLabel: label(3),
      type: 'environmental',
      hazard: null,
      description: 'Silt fence down at the north boundary after rain.',
      location: 'North boundary',
      priority: 'low',
      assigneeCompanyId: null,
      raisedByCompanyId: null,
      status: 'closed',
      dueDate: null,
      isOverdue: false,
      swmsId: null,
      resolutionNote: 'Fence reinstated.',
      availableActions: actionsFor('closed'),
      createdAt: '2026-09-30T01:00:00Z',
      version: 3,
    },
  ],
}));

export const observationsPreview: ObservationsSource = {
  list: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .items.filter(
          (o) =>
            (!f.status || o.status === f.status) &&
            (!f.type || o.type === f.type) &&
            (!f.priority || o.priority === f.priority) &&
            (!f.assigneeCompanyId || o.assigneeCompanyId === f.assigneeCompanyId) &&
            (f.overdue === undefined || o.isOverdue === f.overdue),
        )
        .map((o) => ({ ...o })),
    ),
  create: (projectId, input) => {
    const s = stores.get(projectId);
    const o: Observation = {
      id: mockId('obs'),
      numberLabel: label(s.next++),
      type: input.type,
      hazard: input.hazard ?? null,
      description: input.description,
      location: input.location ?? null,
      priority: input.priority ?? 'medium',
      assigneeCompanyId: input.assigneeCompanyId ?? null,
      raisedByCompanyId: null,
      status: 'open',
      dueDate: input.dueDate ?? null,
      isOverdue: false,
      swmsId: null,
      resolutionNote: null,
      availableActions: actionsFor('open'),
      createdAt: nowIso(),
      version: 1,
    };
    s.items.unshift(o);
    return delay({ ...o });
  },
  transition: (projectId, o, t) => {
    const hit = stores.get(projectId).items.find((x) => x.id === o.id)!;
    if (!hit.availableActions.includes(t.action)) {
      problem(409, 'observation.invalid_transition', 'That isn’t available for this observation.');
    }
    if (needsReason(t.action) && !t.reason?.trim()) {
      problem(422, 'validation.failed', 'A reason is required.');
    }
    if (t.action === 'resolve') {
      hit.status = 'resolved';
      hit.resolutionNote = t.reason?.trim() || null;
    } else if (t.action === 'close') hit.status = 'closed';
    else if (t.action === 'reopen') {
      hit.status = 'open';
      hit.resolutionNote = null;
    }
    hit.availableActions = actionsFor(hit.status);
    hit.version += 1;
    return delay({ ...hit });
  },
};

export function resetObservationsPreview() {
  stores.reset();
}
