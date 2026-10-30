import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createAttendanceApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/attendance';
const worker = {
  id: 'wkr_1',
  userId: null,
  companyId: null,
  companyNameOther: 'Hunter Concrete',
  fullName: 'Jo Tran',
  phone: null,
  email: null,
  kind: 'delivery',
  status: 'active',
  version: 1,
};
const session = (over: Record<string, unknown> = {}) => ({
  id: 'ats_1',
  projectId: 'prj_1',
  siteId: 'wst_1',
  workerId: 'wkr_1',
  companyId: null,
  localDate: '2026-10-01',
  signedInAt: '2026-09-30T22:00:00Z',
  signedOutAt: null,
  minutes: null,
  status: 'on_site',
  version: 1,
  ...over,
});

beforeEach(() => fake.reset());

describe('attendance api', () => {
  it('maps who is on site, keeping a gate-typed company', async () => {
    fake.on('GET', `${P}/on-site`, () => ({
      total: 1,
      companies: [{ companyId: null, companyNameOther: 'Hunter Concrete', count: 1 }],
      people: [{ session: session(), worker }],
    }));
    const r = await createAttendanceApi('org_1').onSite('prj_1');
    expect(r.total).toBe(1);
    expect(r.people[0]).toMatchObject({
      workerName: 'Jo Tran',
      kind: 'delivery',
      companyId: null,
      companyNameOther: 'Hunter Concrete',
      status: 'on_site',
    });
  });

  it("asks for one day and one company's records", async () => {
    fake.on('GET', `${P}/sessions`, () => ({ data: [] }));
    await createAttendanceApi('org_1').day('prj_1', '2026-10-01', 'cmp_a');
    expect(fake.callsTo('GET', `${P}/sessions`)[0]!.init.params?.query).toMatchObject({
      date: '2026-10-01',
      companyId: 'cmp_a',
    });
  });
});
