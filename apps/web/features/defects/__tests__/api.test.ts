import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/uploads', () => ({ uploadFile, fileDownloadUrl: vi.fn() }));

const { createDefectsApi } = await import('../data/api');
const { resetProjectPeople } = await import('@/shared/lib/people');

const P = '/v1/orgs/{orgId}/projects/{projectId}/defects';
const ID = `${P}/{defectId}`;
const TRANSITION = `${ID}/transition`;
const actor = { id: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder' };
const photo = (name = 'wall.jpg', type = 'image/jpeg') => new File(['x'], name, { type });

const apiDefect = (over: Record<string, unknown> = {}) => ({
  id: 'dfx_1',
  projectId: 'prj_1',
  number: 12,
  numberLabel: 'DEF-0012',
  title: 'Chipped tile',
  description: 'Corner chipped',
  status: 'open',
  priority: 'high',
  category: 'finish',
  trade: 'Tiling',
  stage: 'pre_pc',
  locationId: null,
  locationPath: null,
  pin: { drawingRevisionId: 'drv_a101c', x: 0.4, y: 0.6 },
  assigneeCompanyId: 'cmp_tile',
  assigneeUserId: null,
  dueDate: '2026-10-09',
  isOverdue: false,
  raisedByCompanyId: 'cmp_builder',
  issuedAt: '2026-10-01T00:00:00Z',
  readyForReviewAt: null,
  closedAt: null,
  closedBy: null,
  source: 'manual',
  availableActions: ['markReadyForReview', 'dispute'],
  createdBy: 'usr_pm',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 3,
  ...over,
});

const event = (over: Record<string, unknown> = {}) => ({
  id: 'dfe_1',
  defectId: 'dfx_1',
  action: 'issue',
  fromStatus: 'draft',
  toStatus: 'open',
  note: null,
  fileIds: ['fil_before'],
  actorId: 'usr_pm',
  at: '2026-10-01T00:00:00Z',
  ...over,
});

const detail = (d = apiDefect(), events = [event()]) => ({ defect: d, events });

beforeEach(() => {
  fake.reset();
  uploadFile.mockReset();
  resetProjectPeople();
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/members', () => ({
    data: [
      { userId: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder', status: 'active' },
      { userId: 'usr_tile', name: 'Tom Nguyen', companyId: 'cmp_tile', status: 'active' },
    ],
    nextCursor: null,
  }));
  fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', (init) => ({
    id: init.params?.path?.fileId,
    filename: init.params?.path?.fileId === 'fil_before' ? 'tile-before.jpg' : 'other.jpg',
  }));
});

describe('defects API source', () => {
  it('maps the register and passes the filters the API has', async () => {
    fake.on('GET', P, () => ({ data: [apiDefect({ isOverdue: true })], nextCursor: null }));
    const rows = await createDefectsApi('org_1').list('prj_1', {
      status: 'open',
      companyId: 'cmp_tile',
      overdueOn: '2026-10-10',
      q: ' tile ',
      level: 'Ground',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'dfx_1',
        number: 12,
        raisedBy: 'Dana Okafor',
        trade: 'Tiling',
        locationId: null,
        isOverdue: true,
        availableActions: ['markReadyForReview', 'dispute'],
        drawing: { sheetId: '', revisionId: 'drv_a101c', label: 'Drawing', x: 0.4, y: 0.6 },
      }),
    ]);
    expect(fake.callsTo('GET', P)[0]!.init.params!.query).toEqual({
      limit: 200,
      cursor: undefined,
      status: 'open',
      assigneeCompanyId: 'cmp_tile',
      overdue: 'true',
      q: 'tile',
    });
  });

  it('names the history and the photos on a defect', async () => {
    fake.on('GET', ID, () => detail());
    const d = await createDefectsApi('org_1').get('prj_1', 'dfx_1');
    expect(d.events).toEqual([
      expect.objectContaining({ fromStatus: 'draft', toStatus: 'open', by: 'Dana Okafor' }),
    ]);
    expect(d.photos).toEqual([{ id: 'fil_before', name: 'tile-before.jpg', kind: 'before' }]);
  });

  it('drafts the defect on its pin, then issues it with the photos and the Nova suggestion', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_before' });
    fake.on('POST', P, () => detail(apiDefect({ status: 'draft', version: 1 }), []));
    fake.on('GET', ID, () => detail(apiDefect({ status: 'draft', version: 1 }), []));
    fake.on('POST', TRANSITION, () => detail());
    const created = await createDefectsApi('org_1').create(
      'prj_1',
      {
        title: ' Chipped tile ',
        description: '',
        priority: 'high',
        trade: 'Tiling',
        category: 'finish',
        stage: 'pre_pc',
        locationId: null,
        drawing: {
          sheetId: 'sht_1',
          revisionId: 'drv_a101c',
          label: 'A-101 Rev C',
          x: 0.4,
          y: 0.6,
        },
        assigneeCompanyId: 'cmp_tile',
        assigneeUserId: null,
        dueDate: null,
        photos: [photo()],
      },
      actor,
      'ais_01HZZZZZZZZZZZZZZZZZZZZZZZ',
    );
    expect(created.status).toBe('open');
    expect(uploadFile).toHaveBeenCalledWith('org_1', {
      file: expect.any(File),
      projectId: 'prj_1',
      module: 'defects',
    });
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Chipped tile',
      priority: 'high',
      stage: 'pre_pc',
      pin: { drawingRevisionId: 'drv_a101c', x: 0.4, y: 0.6 },
      trade: 'Tiling',
      category: 'finish',
      assigneeCompanyId: 'cmp_tile',
      aiSuggestionId: 'ais_01HZZZZZZZZZZZZZZZZZZZZZZZ',
    });
    const issue = fake.callsTo('POST', TRANSITION)[0]!.init;
    expect(issue.body).toEqual({
      action: 'issue',
      assigneeCompanyId: 'cmp_tile',
      fileIds: ['fil_before'],
    });
    expect(issue.params!.header).toEqual({ 'If-Match': '"1"' });
  });

  it('refuses a defect with no location and no pin before anything is uploaded', async () => {
    await expect(
      createDefectsApi('org_1').create(
        'prj_1',
        {
          title: 'x',
          description: '',
          priority: 'low',
          trade: '',
          category: null,
          stage: 'pre_pc',
          locationId: null,
          drawing: null,
          assigneeCompanyId: 'cmp_tile',
          assigneeUserId: null,
          dueDate: null,
          photos: [photo()],
        },
        actor,
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('raises a defect on a location from the tree with no pin', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_before' });
    fake.on('POST', P, () =>
      detail(
        apiDefect({
          status: 'draft',
          pin: null,
          locationId: 'loc_1',
          locationPath: 'Building A › Level 3',
        }),
      ),
    );
    const created = await createDefectsApi('org_1').create(
      'prj_1',
      {
        title: 'Cracked tile',
        description: '',
        priority: 'low',
        trade: '',
        category: null,
        stage: 'pre_pc',
        locationId: 'loc_1',
        drawing: null,
        assigneeCompanyId: null,
        assigneeUserId: null,
        dueDate: null,
        photos: [],
      },
      actor,
      null,
    );
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      title: 'Cracked tile',
      priority: 'low',
      stage: 'pre_pc',
      locationId: 'loc_1',
    });
    expect(created).toMatchObject({ locationId: 'loc_1', locationPath: 'Building A › Level 3' });
  });

  it('marks ready with the after photos on the version it last read', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_after' });
    fake.on('GET', ID, () => detail());
    fake.on('POST', TRANSITION, () => detail(apiDefect({ status: 'ready_for_review' })));
    const api = createDefectsApi('org_1');
    await api.markReady(
      'prj_1',
      'dfx_1',
      { note: ' Two coats ', photos: [photo('after.jpg')] },
      actor,
    );
    const call = fake.callsTo('POST', TRANSITION)[0]!.init;
    expect(call.body).toEqual({
      action: 'markReadyForReview',
      reason: 'Two coats',
      fileIds: ['fil_after'],
    });
    expect(call.params!.header).toEqual({ 'If-Match': '"3"' });
  });

  it('sends reject, dispute and void with their reason', async () => {
    fake.on('GET', ID, () => detail());
    fake.on('POST', TRANSITION, () => detail());
    await createDefectsApi('org_1').withReason(
      'prj_1',
      'dfx_1',
      'reject',
      ' Colour is off ',
      actor,
    );
    expect(fake.callsTo('POST', TRANSITION)[0]!.init.body).toEqual({
      action: 'reject',
      reason: 'Colour is off',
    });
  });

  it('reassigns a disputed defect, then sets the person and due date', async () => {
    fake.on('GET', ID, () => detail());
    fake.on('POST', TRANSITION, () => detail());
    fake.on('PATCH', ID, () => detail());
    await createDefectsApi('org_1').reassign(
      'prj_1',
      'dfx_1',
      { companyId: 'cmp_dry', userId: 'usr_dry', dueDate: '2026-10-20' },
      actor,
    );
    expect(fake.callsTo('POST', TRANSITION)[0]!.init.body).toEqual({
      action: 'reassign',
      assigneeCompanyId: 'cmp_dry',
    });
    expect(fake.callsTo('PATCH', ID)[0]!.init.body).toEqual({
      assigneeUserId: 'usr_dry',
      dueDate: '2026-10-20',
    });
  });

  it('bulk assign reassigns disputed defects and edits the company on open ones', async () => {
    fake.on('GET', ID, (init) =>
      init.params!.path!.defectId === 'dfx_d'
        ? detail(apiDefect({ id: 'dfx_d', status: 'disputed' }))
        : detail(apiDefect({ id: 'dfx_o' })),
    );
    fake.on('POST', TRANSITION, () => detail());
    fake.on('PATCH', ID, () => detail());
    await createDefectsApi('org_1').bulkAssign(
      'prj_1',
      ['dfx_d', 'dfx_o'],
      { companyId: 'cmp_dry', stage: 'pc' },
      actor,
    );
    expect(fake.callsTo('POST', TRANSITION)).toHaveLength(1);
    // The disputed one is reassigned (a transition) then staged; the open one is edited, then staged.
    expect(fake.callsTo('PATCH', ID).map((c) => c.init.body)).toEqual([
      { stage: 'pc' },
      { assigneeCompanyId: 'cmp_dry', assigneeUserId: null },
      { stage: 'pc' },
    ]);
  });

  it('asks Nova about the photo, note and pin, and records the decision', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_nova' });
    const TAGS = '/v1/orgs/{orgId}/projects/{projectId}/ai/defect-tags';
    const DECISION = '/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions/{suggestionId}/decision';
    fake.on('POST', TAGS, () => ({
      runId: 'air_1',
      suggestionId: 'ais_1',
      title: 'Chipped floor tile',
      description: 'A corner is chipped.',
      trade: 'Tiling',
      alternativeTrades: [],
      category: 'finish',
      priority: 'medium',
      gaps: [],
      unsupportedNumbers: ['600'],
      suggestedCompanies: [{ id: 'cmp_tile', name: 'Ironbark Tiling', trade: 'Tiling' }],
      duplicates: [],
      drawing: null,
    }));
    fake.on('POST', DECISION, () => ({}));
    const api = createDefectsApi('org_1');
    const pin = { sheetId: 's', revisionId: 'drv_a101c', label: 'A', x: 0.1, y: 0.2 };
    const tag = await api.novaSuggest('prj_1', {
      description: 'chipped tile',
      photos: [photo()],
      drawing: pin,
    });
    expect(tag).toMatchObject({
      id: 'ais_1',
      title: 'Chipped floor tile',
      companyId: null,
      unsupportedNumbers: ['600'],
    });
    expect(fake.callsTo('POST', TAGS)[0]!.init.body).toEqual({
      photo: { fileId: 'fil_nova' },
      note: 'chipped tile',
      pin: { drawingRevisionId: 'drv_a101c', x: 0.1, y: 0.2 },
    });
    await api.novaDecide('prj_1', 'ais_1', 'edited');
    expect(fake.callsTo('POST', DECISION)[0]!.init.body).toEqual({ decision: 'edited' });
  });

  it('asks for a photo Nova can read before spending a credit', async () => {
    await expect(
      createDefectsApi('org_1').novaSuggest('prj_1', {
        description: 'x',
        photos: [photo('scan.pdf', 'application/pdf')],
        drawing: null,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('finds open defects pinned beside the same spot, nearest first', async () => {
    fake.on('GET', P, () => ({
      data: [
        apiDefect({ id: 'dfx_far', pin: { drawingRevisionId: 'drv_a101c', x: 0.9, y: 0.9 } }),
        apiDefect({ id: 'dfx_mid', pin: { drawingRevisionId: 'drv_a101c', x: 0.45, y: 0.6 } }),
        apiDefect({ id: 'dfx_near', pin: { drawingRevisionId: 'drv_a101c', x: 0.41, y: 0.6 } }),
        apiDefect({ id: 'dfx_closed', status: 'closed' }),
      ],
      nextCursor: null,
    }));
    const found = await createDefectsApi('org_1').novaDuplicates('prj_1', {
      title: 'x',
      locationId: null,
      drawing: { sheetId: 's', revisionId: 'drv_a101c', label: 'A', x: 0.4, y: 0.6 },
    });
    expect(found.map((d) => d.id)).toEqual(['dfx_near', 'dfx_mid']);
    expect(fake.callsTo('GET', P)[0]!.init.params!.query).toMatchObject({
      drawingRevisionId: 'drv_a101c',
    });
  });
});
