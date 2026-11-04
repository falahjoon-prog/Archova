import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createSwmsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/swms';
const swms = (over: Record<string, unknown> = {}) => ({
  id: 'sws_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'SWMS-0001',
  title: 'Heights',
  companyId: null,
  highRiskWorkCategories: ['fall_2m'],
  content: { workDescription: 'Formwork' },
  fileId: null,
  revision: 2,
  status: 'reviewed',
  reviewedBy: null,
  reviewedAt: null,
  expiresOn: null,
  isExpired: false,
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 5,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  swms: swms(),
  events: [],
  acknowledgements: [],
  gaps: [{ item: 2, field: 'hazardsAndRisks', message: 'List the hazards and risks.' }],
  advisories: [],
  availableActions: ['accept', 'reject'],
  ...over,
});

beforeEach(() => fake.reset());

describe('swms api', () => {
  it('maps a SWMS and its checklist', async () => {
    fake.on('GET', `${P}/{swmsId}`, () => detail());
    const d = await createSwmsApi('org_1').get('prj_1', 'sws_1');
    expect(d.swms).toMatchObject({
      categories: ['fall_2m'],
      workDescription: 'Formwork',
      hazardsAndRisks: '',
    });
    expect(d.gaps).toHaveLength(1);
    expect(d.availableActions).toEqual(['accept', 'reject']);
  });

  it('submits content only when given', async () => {
    fake.on('POST', P, () => detail());
    await createSwmsApi('org_1').create('prj_1', { title: 'Heights', categories: ['fall_2m'] });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Heights',
      highRiskWorkCategories: ['fall_2m'],
    });
  });

  it('sends If-Match, the reason and the understandable confirmation on a transition', async () => {
    fake.on('POST', `${P}/{swmsId}/transition`, () => detail());
    fake.on('GET', `${P}/{swmsId}`, () => detail());
    const api = createSwmsApi('org_1');
    const d = await api.get('prj_1', 'sws_1');
    await api.transition('prj_1', d, { action: 'accept', confirmedUnderstandable: true });
    const call = fake.callsTo('POST', `${P}/{swmsId}/transition`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"5"' });
    expect(call.init.body).toEqual({ action: 'accept', confirmedUnderstandable: true });
  });
});
