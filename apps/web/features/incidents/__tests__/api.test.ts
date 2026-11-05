import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createIncidentsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/incidents';
const incident = (over: Record<string, unknown> = {}) => ({
  id: 'inx_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'INC-0001',
  title: 'Cut hand',
  type: 'injury',
  severity: 'high',
  occurredAt: '2026-11-02T22:30:00Z',
  location: null,
  description: '',
  immediateActions: null,
  isNotifiable: true,
  notifiableClass: 'serious_injury_illness',
  regulatorNotifiedAt: null,
  writtenNoticeRequestedAt: null,
  writtenNoticeDueAt: null,
  keepUntil: null,
  rootCause: null,
  status: 'investigating',
  closedAt: null,
  openActions: 1,
  createdBy: null,
  createdAt: '2026-11-02T22:40:00Z',
  updatedAt: '2026-11-02T22:40:00Z',
  version: 4,
  ...over,
});
const action = (over: Record<string, unknown> = {}) => ({
  id: 'iac_1',
  incidentId: 'inx_1',
  number: 1,
  title: 'Fit guards',
  description: null,
  assigneeCompanyId: null,
  assigneeUserId: null,
  dueDate: null,
  source: null,
  status: 'open',
  isOverdue: false,
  completedAt: null,
  verifiedAt: null,
  version: 3,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  incident: incident(),
  people: [],
  injuryHidden: true,
  actions: [action()],
  events: [],
  closeBlockers: [{ field: 'rootCause', message: 'Record the root cause before closing.' }],
  canManage: true,
  ...over,
});

beforeEach(() => fake.reset());

describe('incidents api', () => {
  it('maps an incident, its blockers and the withheld injury flag', async () => {
    fake.on('GET', `${P}/{incidentId}`, () => detail());
    const d = await createIncidentsApi('org_1').get('prj_1', 'inx_1');
    expect(d.incident).toMatchObject({
      numberLabel: 'INC-0001',
      isNotifiable: true,
      openActions: 1,
    });
    expect(d.injuryHidden).toBe(true);
    expect(d.closeBlockers).toHaveLength(1);
    expect(d.actions[0]).toMatchObject({ title: 'Fit guards', status: 'open' });
  });

  it('reports only the fields given', async () => {
    fake.on('POST', P, () => detail());
    await createIncidentsApi('org_1').report('prj_1', {
      title: 'Cut hand',
      type: 'injury',
      occurredAt: '2026-11-02T22:30:00.000Z',
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Cut hand',
      type: 'injury',
      occurredAt: '2026-11-02T22:30:00.000Z',
    });
  });

  it('sends If-Match with the incident version on a transition', async () => {
    fake.on('GET', `${P}/{incidentId}`, () => detail());
    fake.on('POST', `${P}/{incidentId}/transition`, () => detail());
    const api = createIncidentsApi('org_1');
    const d = await api.get('prj_1', 'inx_1');
    await api.transition('prj_1', d, { action: 'close' });
    const call = fake.callsTo('POST', `${P}/{incidentId}/transition`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    expect(call.init.body).toEqual({ action: 'close' });
  });

  it('updates an action with its own version, then reloads the incident', async () => {
    fake.on('GET', `${P}/{incidentId}`, () => detail());
    fake.on('PATCH', `${P}/{incidentId}/actions/{actionId}`, () => action({ status: 'done' }));
    const api = createIncidentsApi('org_1');
    const d = await api.get('prj_1', 'inx_1');
    await api.setActionStatus('prj_1', d, 'iac_1', 'done');
    const call = fake.callsTo('PATCH', `${P}/{incidentId}/actions/{actionId}`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"3"' });
    expect(call.init.body).toEqual({ status: 'done' });
    expect(fake.callsTo('GET', `${P}/{incidentId}`)).toHaveLength(2);
  });

  it('reads the actions raised from an inspection or observation', async () => {
    const path = '/v1/orgs/{orgId}/projects/{projectId}/incident-actions';
    fake.on('GET', path, () => ({
      data: [
        {
          action: action({ source: { type: 'observation', id: 'obs_1' } }),
          incidentId: 'inx_1',
          incidentNumberLabel: 'INC-0001',
          incidentTitle: 'Cut hand',
        },
      ],
    }));
    const rows = await createIncidentsApi('org_1').fromSource('prj_1', {
      type: 'observation',
      id: 'obs_1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ incidentNumberLabel: 'INC-0001' });
    expect(rows[0]!.action.source).toEqual({ type: 'observation', id: 'obs_1' });
    expect(fake.callsTo('GET', path)[0]!.init.params!.query).toEqual({
      sourceType: 'observation',
      sourceId: 'obs_1',
    });
  });
});
