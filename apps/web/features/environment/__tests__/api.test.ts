import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createEnvironmentApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/environment';
const cond = (over: Record<string, unknown> = {}) => ({
  id: 'ecn_1',
  projectId: 'prj_1',
  number: 3,
  numberLabel: 'EMC-0003',
  title: 'Dust suppression',
  requirement: null,
  category: 'air_quality',
  source: 'cemp',
  sourceReference: null,
  frequency: 'daily',
  responsibleCompanyId: null,
  responsibleUserId: null,
  status: 'in_progress',
  dueDate: '2026-11-08',
  lastReviewedOn: null,
  isOverdue: false,
  fileIds: ['fil_1'],
  availableActions: ['signOff'],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 4,
  ...over,
});

beforeEach(() => fake.reset());

describe('environment api', () => {
  it('lists with filters and maps the register', async () => {
    fake.on('GET', `${P}/conditions`, () => ({ data: [cond()], nextCursor: null }));
    const r = await createEnvironmentApi('org_1').listConditions('prj_1', {
      status: 'in_progress',
      overdue: false,
    });
    expect(r[0]).toMatchObject({ numberLabel: 'EMC-0003', evidenceCount: 1 });
    expect(fake.callsTo('GET', `${P}/conditions`)[0]!.init.params!.query).toMatchObject({
      status: 'in_progress',
      overdue: 'false',
    });
  });

  it('sends If-Match, the action and the note on a transition', async () => {
    fake.on('POST', `${P}/conditions/{conditionId}/transition`, () => ({
      condition: cond({ status: 'compliant' }),
      events: [],
    }));
    const api = createEnvironmentApi('org_1');
    const c = (
      await (async () => {
        fake.on('GET', `${P}/conditions`, () => ({ data: [cond()], nextCursor: null }));
        return api.listConditions('prj_1', {});
      })()
    )[0]!;
    const r = await api.transition('prj_1', c, { action: 'signOff', note: 'Checked' });
    expect(r.status).toBe('compliant');
    const call = fake.callsTo('POST', `${P}/conditions/{conditionId}/transition`)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    expect(call.init.body).toEqual({ action: 'signOff', note: 'Checked' });
  });

  it('maps the summary and its flags', async () => {
    fake.on('GET', `${P}/summary`, () => ({
      today: '2026-11-07',
      plan: null,
      conditions: {
        total: 0,
        byStatus: {
          not_started: 0,
          in_progress: 0,
          compliant: 0,
          non_compliant: 0,
          not_applicable: 0,
        },
        overdue: 0,
        compliancePercent: null,
        byCategory: [],
      },
      documents: { total: 0, expired: 0, expiring: 0 },
      flags: [
        {
          code: 'plan_missing',
          severity: 'warning',
          message: 'No EMP',
          conditionIds: [],
          documentIds: [],
        },
      ],
    }));
    const s = await createEnvironmentApi('org_1').summary('prj_1');
    expect(s.plan).toBeNull();
    expect(s.flags).toEqual([{ code: 'plan_missing', severity: 'warning', message: 'No EMP' }]);
  });

  it('maps monitoring points and sends a reading with its evidence ids', async () => {
    const reading = {
      id: 'erd_1',
      pointId: 'mpt_1',
      pointName: null,
      unit: null,
      value: 61,
      takenAt: '2026-11-08T01:00:00Z',
      status: 'breach',
      note: null,
      fileIds: [],
      responseNote: null,
      respondedAt: null,
      incidentId: null,
    };
    fake.on('GET', `${P}/monitoring-points`, () => ({
      data: [
        {
          id: 'mpt_1',
          projectId: 'prj_1',
          name: 'North dust',
          parameter: 'dust_pm10',
          unit: 'µg/m³',
          location: null,
          minLimit: null,
          maxLimit: 50,
          warnMargin: 0.2,
          frequency: 'daily',
          conditionId: null,
          active: true,
          latest: reading,
          recent: [40, 61],
          openBreaches: 1,
          isOverdue: false,
          isTrending: false,
          version: 1,
        },
      ],
    }));
    const points = await createEnvironmentApi('org_1').listPoints('prj_1');
    expect(points[0]).toMatchObject({ name: 'North dust', openBreaches: 1 });
    expect(points[0]!.latest).toMatchObject({ status: 'breach', evidenceCount: 0 });

    fake.on('POST', `${P}/monitoring-points/{pointId}/readings`, () => reading);
    const logged = await createEnvironmentApi('org_1').logReading('prj_1', points[0]!, {
      value: 61,
      note: 'Windy',
    });
    expect(logged.status).toBe('breach');
    expect(fake.callsTo('POST', `${P}/monitoring-points/{pointId}/readings`)[0]!.init.body).toEqual(
      { value: 61, note: 'Windy' },
    );
  });
});
