import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createObservationsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/observations';
const obs = (over: Record<string, unknown> = {}) => ({
  id: 'obs_1',
  projectId: 'prj_1',
  number: 7,
  numberLabel: 'OBS-0007',
  type: 'safety',
  hazard: 'Edge',
  description: 'No edge protection',
  location: 'Level 2',
  priority: 'high',
  assigneeCompanyId: null,
  raisedByCompanyId: null,
  status: 'open',
  dueDate: null,
  isOverdue: false,
  swmsId: null,
  resolutionNote: null,
  fileIds: [],
  resolvedAt: null,
  closedAt: null,
  availableActions: ['resolve'],
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 3,
  ...over,
});

beforeEach(() => fake.reset());

describe('observations api', () => {
  it('lists with filters and maps the register', async () => {
    fake.on('GET', P, () => ({ data: [obs()], nextCursor: null }));
    const r = await createObservationsApi('org_1').list('prj_1', {
      status: 'open',
      overdue: true,
    });
    expect(r[0]).toMatchObject({ numberLabel: 'OBS-0007', availableActions: ['resolve'] });
    const query = fake.callsTo('GET', P)[0]!.init.params!.query;
    expect(query).toMatchObject({ status: 'open', overdue: 'true' });
  });

  it('sends If-Match and the reason on a transition', async () => {
    fake.on('POST', `${P}/{observationId}/transition`, () => obs({ status: 'resolved' }));
    const o = (
      await (async () => {
        fake.on('GET', P, () => ({ data: [obs()], nextCursor: null }));
        return createObservationsApi('org_1').list('prj_1', {});
      })()
    )[0]!;
    const r = await createObservationsApi('org_1').transition('prj_1', o, {
      action: 'resolve',
      reason: 'Fixed',
    });
    expect(r.status).toBe('resolved');
    const call = fake.callsTo('POST', `${P}/{observationId}/transition`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"3"' });
    expect(call.init.body).toEqual({ action: 'resolve', reason: 'Fixed' });
  });
});
