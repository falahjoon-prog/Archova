import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createInspectionsApi } = await import('../data/api');

const I = '/v1/orgs/{orgId}/projects/{projectId}/inspections';
const detail = (over: Record<string, unknown> = {}) => ({
  inspection: {
    id: 'ins_1',
    projectId: 'prj_1',
    number: 3,
    numberLabel: 'INS-0003',
    templateId: 'itp_1',
    templateVersion: 1,
    title: 'Pre-pour',
    location: null,
    status: 'in_progress',
    inspectorId: null,
    scheduledFor: null,
    completedAt: null,
    signedBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 6,
  },
  items: [
    {
      id: 'iti_1',
      section: 'Pour',
      sort: 1,
      prompt: 'Rebar OK',
      responseType: 'pass_fail_na',
      options: [],
      required: true,
      createsDefectOnFail: true,
    },
  ],
  responses: [],
  missingRequiredItemIds: ['iti_1'],
  failedItemIds: [],
  ...over,
});

beforeEach(() => fake.reset());

describe('inspections api', () => {
  it('maps an inspection with what is still unanswered', async () => {
    fake.on('GET', `${I}/{inspectionId}`, () => detail());
    const d = await createInspectionsApi('org_1').get('prj_1', 'ins_1');
    expect(d.inspection).toMatchObject({
      numberLabel: 'INS-0003',
      status: 'in_progress',
      signedByName: null,
    });
    expect(d.items[0]).toMatchObject({ responseType: 'pass_fail_na', createsDefectOnFail: true });
    expect(d.missingRequiredItemIds).toEqual(['iti_1']);
  });

  it('saves answers, then signs with If-Match', async () => {
    fake.on('PUT', `${I}/{inspectionId}/responses`, () => detail());
    fake.on('POST', `${I}/{inspectionId}/submit`, () => detail());
    const api = createInspectionsApi('org_1');
    await api.record('prj_1', 'ins_1', [{ templateItemId: 'iti_1', result: 'pass' }]);
    expect(fake.callsTo('PUT', `${I}/{inspectionId}/responses`)[0]!.init.body).toEqual({
      responses: [{ templateItemId: 'iti_1', result: 'pass' }],
    });
    const d = detail();
    await api.submit(
      'prj_1',
      {
        inspection: { ...d.inspection, signedByName: null } as never,
        items: [],
        responses: [],
        missingRequiredItemIds: [],
        failedItemIds: [],
      },
      'Sam Lee',
    );
    const call = fake.callsTo('POST', `${I}/{inspectionId}/submit`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"6"' });
    expect(call.init.body).toEqual({ signedByName: 'Sam Lee' });
  });
});
