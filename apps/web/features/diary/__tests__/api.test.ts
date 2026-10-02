import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { fakeProblem } = await import('@/test/fake-api');
const { createDiaryApi } = await import('../data/api');
const { emptyContent } = await import('../data/source');
const { resetProjectPeople } = await import('@/shared/lib/people');

const P = '/v1/orgs/{orgId}/projects/{projectId}/diary';
const D = `${P}/{date}`;
const actor = { id: 'usr_sm', name: 'Luca Romano' };
const id26 = (prefix: string, n: number) => `${prefix}_${String(n).padStart(26, '0')}`;
const FORM = id26('cmp', 1);
const ELEC = id26('cmp', 2);

const at = '2026-10-01T00:00:00Z';
const apiEntry = (over: Record<string, unknown> = {}) => ({
  id: id26('dia', 1),
  projectId: 'prj_1',
  date: '2026-10-01',
  status: 'draft',
  weather: {
    minTempC: 12,
    maxTempC: 19,
    rainfallMm: 18,
    windKmh: 20,
    windDirection: 'S',
    conditions: { am: 'Rain', midday: 'Rain', pm: 'Showers' },
  },
  weatherStationId: '066214',
  weatherOverride: null,
  weatherNotes: null,
  siteConditions: null,
  notes: 'Wet afternoon.',
  fileIds: [],
  submittedBy: null,
  submittedAt: null,
  submitReceivedAt: null,
  isLate: false,
  lateAfter: '2026-10-01T23:00:00Z',
  signedOffBy: null,
  signedOffAt: null,
  totals: { labourCompanies: 1, labourHeadcount: 6, labourHours: 27, delayHours: 4.5 },
  createdAt: at,
  updatedAt: at,
  version: 4,
  ...over,
});
const labour = (n: number, over: Record<string, unknown> = {}) => ({
  id: id26('dlb', n),
  projectId: 'prj_1',
  entryId: id26('dia', 1),
  companyId: FORM,
  trade: 'Formwork',
  headcount: 6,
  hours: 27,
  notes: null,
  editReason: null,
  source: 'manual',
  attendanceHeadcount: null,
  attendanceHours: null,
  createdAt: at,
  updatedAt: at,
  version: 2,
  ...over,
});
const delay = (n: number, over: Record<string, unknown> = {}) => ({
  id: id26('ddy', n),
  projectId: 'prj_1',
  entryId: id26('dia', 1),
  type: 'weather',
  description: 'Rain from 11am',
  hours: 4.5,
  affectedCompanyIds: [FORM],
  isEotCandidate: true,
  createdAt: at,
  updatedAt: at,
  version: 1,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  entry: apiEntry(),
  labour: [labour(1)],
  plant: [],
  deliveries: [],
  delays: [delay(1)],
  visitors: [],
  events: [],
  standDowns: [
    {
      id: id26('dsd', 1),
      projectId: 'prj_1',
      entryId: id26('dia', 1),
      startTime: '11:00',
      endTime: '15:30',
      affectedCompanyIds: [FORM],
      reason: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    },
  ],
  amendments: [],
  ...over,
});

beforeEach(() => {
  fake.reset();
  resetProjectPeople();
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/members', () => ({
    data: [{ userId: 'usr_sm', name: 'Luca Romano', companyId: 'cmp_builder', status: 'active' }],
    nextCursor: null,
  }));
});

describe('Site diary API source', () => {
  it('maps a day, its lines, stand-down and amendments', async () => {
    fake.on('GET', D, () =>
      detail({
        entry: apiEntry({
          status: 'submitted',
          submittedBy: 'usr_sm',
          submittedAt: '2026-10-01T07:00:00Z',
          isLate: true,
          weatherOverride: { minTempC: 11, maxTempC: 18, rainfallMm: 22, windKmh: 25 },
        }),
        amendments: [
          {
            id: 'amd_1',
            targetType: 'labour',
            targetId: id26('dlb', 1),
            action: 'update',
            changes: { headcount: [5, 6], companyId: [ELEC, FORM] },
            reason: 'Timesheet',
            amendedBy: 'usr_sm',
            amendedAt: at,
          },
        ],
      }),
    );
    const day = await createDiaryApi('org_1').getDay('prj_1', '2026-10-01', '2026-10-02');
    expect(day).toMatchObject({
      status: 'submitted',
      late: true,
      submittedBy: 'Luca Romano',
      version: 4,
      weather: { stationId: '066214', rainMm: 22, conditions: { at7am: null } },
      content: {
        notes: 'Wet afternoon.',
        standDown: { active: true, start: '11:00', end: '15:30', companyIds: [FORM] },
        labour: [{ id: id26('dlb', 1), companyId: FORM, trade: 'Formwork', headcount: 6 }],
        delays: [{ type: 'weather', hours: 4.5, isEotCandidate: true }],
      },
    });
    expect(day.amendments[0]).toMatchObject({
      reason: 'Timesheet',
      by: 'Luca Romano',
      changes: [
        { field: 'Labour · headcount', before: '5', after: '6' },
        { field: 'Labour · company', before: ELEC, after: FORM },
      ],
    });
  });

  it("starts an unwritten day with the last entry's companies, counts blank", async () => {
    fake.on('GET', D, ({ params }) =>
      params?.path?.date === '2026-09-30' ? detail() : fakeProblem(404, 'diary.not_found'),
    );
    fake.on('GET', P, () => ({ data: [apiEntry({ date: '2026-09-30' })] }));
    const day = await createDiaryApi('org_1').getDay('prj_1', '2026-10-02', '2026-10-02');
    expect(day.status).toBe('draft');
    expect(day.content.labour).toEqual([
      expect.objectContaining({ companyId: FORM, trade: 'Formwork', headcount: null, hours: null }),
    ]);
    expect(fake.callsTo('GET', P)[0]!.init.params?.query).toEqual({
      from: '2026-09-02',
      to: '2026-10-01',
    });
  });

  it('saves a draft line by line, and maps new lines so the next save does not repeat them', async () => {
    let state = detail();
    fake.on('GET', D, () => state);
    fake.on('POST', `${D}/labour`, ({ body }) => {
      const line = labour(2, body as Record<string, unknown>);
      state = { ...state, labour: [...state.labour, line] };
      return line;
    });
    fake.on('PATCH', `${D}/delays/{lineId}`, ({ body }) =>
      delay(1, body as Record<string, unknown>),
    );
    fake.on('DELETE', `${D}/stand-downs/{lineId}`, () => {
      state = { ...state, standDowns: [] };
      return undefined;
    });
    fake.on('PUT', D, () => state);
    const source = createDiaryApi('org_1');
    const day = await source.getDay('prj_1', '2026-10-01', '2026-10-02');
    const content = {
      ...day.content,
      standDown: { active: false, start: null, end: null, companyIds: [] },
      labour: [
        ...day.content.labour,
        { id: 'lab_local', companyId: ELEC, trade: '', headcount: 3, hours: 24 },
      ],
      delays: [{ ...day.content.delays[0]!, hours: 5 }],
      plant: [
        { id: 'plt_local', description: ' ', quantity: 1, hours: null, status: 'working' as const },
      ],
      notes: 'Wet afternoon. Pour moved to Monday.',
    };

    await source.saveDraft('prj_1', '2026-10-01', content);
    expect(fake.callsTo('POST', `${D}/labour`)).toHaveLength(1);
    expect(fake.callsTo('POST', `${D}/labour`)[0]!.init.body).toEqual({
      companyId: ELEC,
      trade: null,
      headcount: 3,
      hours: 24,
    });
    // The blank plant line waits until it has a description.
    expect(fake.callsTo('POST', `${D}/plant`)).toHaveLength(0);
    expect(fake.callsTo('PATCH', `${D}/delays/{lineId}`)[0]!.init.params?.header).toEqual({
      'If-Match': '"1"',
    });
    expect(fake.callsTo('DELETE', `${D}/stand-downs/{lineId}`)).toHaveLength(1);
    expect(fake.callsTo('PUT', D)[0]!.init).toMatchObject({
      params: { header: { 'If-Match': '"4"' } },
      body: { notes: 'Wet afternoon. Pour moved to Monday.', weatherNotes: null, fileIds: [] },
    });

    await source.saveDraft('prj_1', '2026-10-01', content);
    expect(fake.callsTo('POST', `${D}/labour`)).toHaveLength(1);
    expect(fake.callsTo('DELETE', `${D}/labour/{lineId}`)).toHaveLength(0);
  });

  it('holds a changed sign-in line until it has a reason, then sends the reason', async () => {
    const signIn = labour(1, {
      source: 'attendance',
      trade: null,
      headcount: 6,
      hours: 48,
      attendanceHeadcount: 6,
      attendanceHours: 48,
    });
    const state = detail({ labour: [signIn], delays: [], standDowns: [] });
    fake.on('GET', D, () => state);
    fake.on('PATCH', `${D}/labour/{lineId}`, ({ body }) =>
      labour(1, { ...signIn, ...(body as Record<string, unknown>) }),
    );
    fake.on('PUT', D, () => state);
    const source = createDiaryApi('org_1');
    const day = await source.getDay('prj_1', '2026-10-01', '2026-10-02');
    const line = day.content.labour[0]!;
    expect(line).toMatchObject({ signIn: { headcount: 6, hours: 48 }, editReason: '' });

    const changed = { ...line, headcount: 5 };
    await source.saveDraft('prj_1', '2026-10-01', { ...day.content, labour: [changed] });
    expect(fake.callsTo('PATCH', `${D}/labour/{lineId}`)).toHaveLength(0);
    expect(fake.callsTo('DELETE', `${D}/labour/{lineId}`)).toHaveLength(0);

    await source.saveDraft('prj_1', '2026-10-01', {
      ...day.content,
      labour: [{ ...changed, editReason: ' One left before signing out ' }],
    });
    expect(fake.callsTo('PATCH', `${D}/labour/{lineId}`)[0]!.init.body).toMatchObject({
      headcount: 5,
      hours: 48,
      editReason: 'One left before signing out',
    });
  });

  it('sends the amendment reason with every change after submit', async () => {
    const state = detail({ entry: apiEntry({ status: 'submitted' }) });
    fake.on('GET', D, () => state);
    fake.on('DELETE', `${D}/delays/{lineId}`, () => undefined);
    const source = createDiaryApi('org_1');
    const day = await source.getDay('prj_1', '2026-10-01', '2026-10-02');
    await source.amend(
      'prj_1',
      '2026-10-01',
      { ...day.content, delays: [] },
      ' Not a delay after all ',
      actor,
    );
    expect(fake.callsTo('DELETE', `${D}/delays/{lineId}`)[0]!.init.params).toMatchObject({
      path: { lineId: id26('ddy', 1) },
      query: { amendmentReason: 'Not a delay after all' },
    });
    expect(fake.callsTo('PUT', D)).toHaveLength(0);
  });

  it('submits against the latest version, creating an empty day first', async () => {
    let state: ReturnType<typeof detail> | null = null;
    fake.on('GET', D, () => state ?? fakeProblem(404, 'diary.not_found'));
    fake.on('GET', P, () => ({ data: [] }));
    fake.on('PUT', D, () => (state = detail({ labour: [], delays: [], standDowns: [] })));
    fake.on('POST', `${D}/submit`, () => ({
      ...state!,
      entry: apiEntry({ status: 'submitted', version: 5 }),
    }));
    const day = await createDiaryApi('org_1').submit(
      'prj_1',
      '2026-10-01',
      emptyContent(),
      actor,
      'Australia/Sydney',
    );
    expect(day.status).toBe('submitted');
    expect(fake.callsTo('PUT', D)[0]!.init.params?.header).toBeUndefined();
    expect(fake.callsTo('POST', `${D}/submit`)[0]!.init.params?.header).toEqual({
      'If-Match': '"4"',
    });
  });
});
