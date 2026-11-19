import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const upload = vi.hoisted(() => vi.fn(async () => ({ id: 'fil_sig' })));
vi.mock('@/shared/lib/uploads', () => ({ uploadFile: upload }));

const { createPretaskApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/pretask-plans';
const plan = {
  id: 'ptk_1',
  projectId: 'prj_1',
  number: 1,
  numberLabel: 'PTP-0001',
  taskTitle: 'Edge protection',
  workDate: '2026-11-19',
  location: null,
  companyId: null,
  swmsId: null,
  supervisorName: 'Pat',
  hazards: [{ hazard: 'Falls', riskBefore: 'high', controls: 'Rails', riskAfter: 'low' }],
  status: 'open',
  closedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
  crewCount: 1,
  signedCount: 0,
  createdBy: null,
  createdAt: '2026-11-19T00:00:00Z',
  version: 4,
};
const detail = () => ({
  plan,
  crew: [
    {
      id: 'ptw_1',
      personName: 'Sam',
      companyId: null,
      userId: null,
      signedAt: null,
      signatureFileId: null,
      inductionStatus: null,
      swmsRead: null,
    },
  ],
  swms: null,
  closeBlockers: ['1 person has not signed on. Sign, or remove them.'],
  warnings: [
    { code: 'induction', message: 'Sam has not done the site induction.', personName: 'Sam' },
  ],
  events: [{ id: 'e1', action: 'created', note: null, actor: null, at: '2026-11-19T00:00:00Z' }],
  canEdit: true,
  canReview: false,
});

beforeEach(() => {
  fake.reset();
  upload.mockClear();
});

describe('pretask api', () => {
  it('maps a plan with its hazards, crew, warnings and trail', async () => {
    fake.on('GET', `${P}/{planId}`, () => detail());
    const d = await createPretaskApi('org_1').getPlan('prj_1', 'ptk_1');
    expect(d.plan.numberLabel).toBe('PTP-0001');
    expect(d.plan.hazards[0]!.controls).toBe('Rails');
    expect(d.warnings[0]!.code).toBe('induction');
    expect(d.events).toHaveLength(1);
  });

  it('creates a plan with only the fields that were given', async () => {
    fake.on('POST', P, () => detail());
    await createPretaskApi('org_1').createPlan('prj_1', {
      taskTitle: 'Edge protection',
      workDate: '2026-11-19',
      supervisorName: 'Pat',
      hazards: plan.hazards as never,
      crew: [],
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      taskTitle: 'Edge protection',
      workDate: '2026-11-19',
      supervisorName: 'Pat',
      hazards: plan.hazards,
    });
  });

  it('uploads the signature image to the safety module, then signs one person on with If-Match', async () => {
    const sig = `${P}/{planId}/crew/{crewId}/signature`;
    fake.on('PUT', sig, () => detail());
    fake.on('GET', `${P}/{planId}`, () => detail());
    const api = createPretaskApi('org_1');
    const d = await api.getPlan('prj_1', 'ptk_1');
    await api.sign('prj_1', d, 'ptw_1', new Blob(['x'], { type: 'image/png' }));
    expect(upload).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ projectId: 'prj_1', module: 'safety' }),
    );
    const call = fake.callsTo('PUT', sig)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    expect(call.init.body).toEqual({ signatureFileId: 'fil_sig' });
  });
});
