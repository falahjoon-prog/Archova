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

  const gate = (over: Record<string, unknown> = {}) => ({
    id: 'wgt_1',
    siteId: 'wst_1',
    name: 'Front gate',
    qrVersion: 1,
    active: true,
    version: 4,
    ...over,
  });

  it('lists sites with gates', async () => {
    fake.on('GET', `${P}/sites`, () => ({
      data: [
        {
          id: 'wst_1',
          projectId: 'prj_1',
          name: 'Main site',
          boundary: null,
          dayEndLocal: '19:00',
          gateCheckMode: 'block',
          active: true,
          gates: [gate()],
          version: 2,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    }));
    const sites = await createAttendanceApi('org_1').sites('prj_1');
    expect(sites[0]).toMatchObject({ name: 'Main site', dayEndLocal: '19:00', version: 2 });
    expect(sites[0]!.gates[0]).toMatchObject({ name: 'Front gate', qrVersion: 1 });
  });

  it('returns the code from a new gate and sends If-Match on reissue', async () => {
    fake.on('POST', `${P}/sites/{siteId}/gates`, () => ({ gate: gate(), code: 'gqr_one' }));
    fake.on('POST', `${P}/gates/{gateId}/reissue`, () => ({
      gate: gate({ qrVersion: 2, version: 5 }),
      code: 'gqr_two',
    }));
    const api = createAttendanceApi('org_1');
    const made = await api.createGate('prj_1', 'wst_1', 'Front gate');
    expect(made.code).toBe('gqr_one');
    const again = await api.reissueGate('prj_1', made.gate);
    expect(again).toMatchObject({ code: 'gqr_two', gate: { qrVersion: 2 } });
    expect(fake.callsTo('POST', `${P}/gates/{gateId}/reissue`)[0]!.init.params?.header).toEqual({
      'If-Match': '"4"',
    });
  });

  it('maps a roll call and posts a mark', async () => {
    const rollCall = (status: string) => ({
      id: 'rlc_1',
      projectId: 'prj_1',
      siteId: null,
      reason: 'Fire alarm',
      startedAt: '2026-10-01T00:00:00Z',
      startedBy: null,
      endedAt: null,
      counts: {
        total: 1,
        accountedFor: status === 'accounted_for' ? 1 : 0,
        missing: 0,
        unmarked: 0,
      },
      people: [
        {
          workerId: 'wkr_1',
          fullName: 'Jo Tran',
          phone: '0400 000 000',
          companyId: null,
          companyNameOther: 'Hunter Concrete',
          siteId: null,
          signedInAt: '2026-09-30T22:00:00Z',
          status,
          markedAt: null,
          markedBy: null,
        },
      ],
    });
    fake.on('GET', `${P}/roll-calls`, () => ({ data: [rollCall('unmarked')] }));
    fake.on('POST', `${P}/roll-calls/{rollCallId}/marks`, () => rollCall('accounted_for'));
    const api = createAttendanceApi('org_1');
    const list = await api.rollCalls('prj_1');
    expect(list[0]).toMatchObject({ reason: 'Fire alarm', endedAt: null });
    expect(list[0]!.people[0]).toMatchObject({ fullName: 'Jo Tran', status: 'unmarked' });
    const marked = await api.markRollCall('prj_1', 'rlc_1', 'wkr_1', 'accounted_for');
    expect(marked.counts.accountedFor).toBe(1);
    expect(fake.callsTo('POST', `${P}/roll-calls/{rollCallId}/marks`)[0]!.init.body).toEqual({
      workerId: 'wkr_1',
      status: 'accounted_for',
    });
  });
});
