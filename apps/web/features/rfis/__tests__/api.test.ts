import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createRfisApi } = await import('../data/api');
const { resetProjectPeople } = await import('@/shared/lib/people');

const P = '/v1/orgs/{orgId}/projects/{projectId}/rfis';
const actor = { id: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder' };

const apiRfi = (over: Record<string, unknown> = {}) => ({
  id: 'rfi_1',
  projectId: 'prj_1',
  number: 4,
  numberLabel: 'RFI-004',
  subject: 'Lighting circuit in retail 2',
  question: 'Four downlights or six?',
  status: 'open',
  isPrivate: false,
  managerId: 'usr_pm',
  raisedByCompanyId: 'cmp_builder',
  receivedFromCompanyId: null,
  assignees: [
    { userId: 'usr_elec', companyId: 'cmp_elec', isBallInCourt: true, respondedAt: null },
  ],
  ballInCourt: { side: 'assignees', userIds: ['usr_elec'] },
  distributionUserIds: [],
  distributionCompanyIds: ['cmp_arch'],
  dueDate: '2026-10-09',
  isOverdue: false,
  openedAt: '2026-10-01T00:00:00Z',
  answeredAt: null,
  closedAt: null,
  voidReason: null,
  costImpact: 'tbc',
  costEstimate: null,
  scheduleImpactDays: null,
  delayDays: null,
  specSection: '03 30 00 Concrete',
  location: 'Level 2, gridline C',
  pin: { drawingRevisionId: 'drv_e301a', x: 0.4, y: 0.6 },
  officialResponseId: null,
  createdBy: 'usr_pm',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 3,
  ...over,
});

beforeEach(() => {
  fake.reset();
  resetProjectPeople();
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/members', () => ({
    data: [
      { userId: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder', status: 'active' },
      { userId: 'usr_elec', name: 'Sam Patel', companyId: 'cmp_elec', status: 'active' },
    ],
    nextCursor: null,
  }));
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}/activity', () => ({
    data: [],
  }));
});

describe('RFIs API source', () => {
  it('maps the register, with the ball in court and its company from the assignees', async () => {
    fake.on('GET', P, () => ({ data: [apiRfi()], nextCursor: null }));
    const rows = await createRfisApi('org_1').list('prj_1', {
      status: 'open',
      ballInCourtCompanyId: 'cmp_elec',
      overdueBefore: '2026-10-02',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        number: 4,
        assigneeId: 'usr_elec',
        assigneeCompanyId: 'cmp_elec',
        ballInCourtId: 'usr_elec',
        ballInCourtCompanyId: 'cmp_elec',
        drawing: { sheetId: '', revisionId: 'drv_e301a', label: 'Drawing' },
        specSection: '03 30 00 Concrete',
        location: 'Level 2, gridline C',
        version: 3,
      }),
    ]);
    expect(fake.callsTo('GET', P)[0]!.init.params?.query).toMatchObject({
      status: 'open',
      overdue: 'true',
    });
  });

  it('names response authors from the project members and closes with the version seen', async () => {
    const detail = (over: Record<string, unknown> = {}) => ({
      rfi: apiRfi({ status: 'answered', ...over }),
      responses: [
        {
          id: 'rfr_1',
          rfiId: 'rfi_1',
          authorId: 'usr_elec',
          body: 'Six.',
          fileIds: [],
          isOfficial: false,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
    });
    fake.on('GET', `${P}/{rfiId}`, () => detail());
    fake.on('POST', `${P}/{rfiId}/close`, () =>
      detail({ status: 'closed', officialResponseId: 'rfr_1', version: 4 }),
    );
    const source = createRfisApi('org_1');
    const rfi = await source.get('prj_1', 'rfi_1');
    expect(rfi.responses[0]).toMatchObject({
      authorName: 'Sam Patel',
      authorCompanyId: 'cmp_elec',
    });

    const closed = await source.close('prj_1', 'rfi_1', 'rfr_1', actor);
    const call = fake.callsTo('POST', `${P}/{rfiId}/close`)[0]!;
    expect(call.init.params?.header).toEqual({ 'If-Match': '"3"' });
    expect(call.init.body).toEqual({ officialResponseId: 'rfr_1' });
    expect(closed).toMatchObject({ status: 'closed', officialResponseId: 'rfr_1' });
  });

  it('creates a draft and opens it when submitting', async () => {
    fake.on('POST', P, () => ({
      rfi: apiRfi({ status: 'draft', number: null, version: 1 }),
      responses: [],
    }));
    fake.on('GET', `${P}/{rfiId}`, () => ({
      rfi: apiRfi({ status: 'draft', number: null, version: 1 }),
      responses: [],
    }));
    fake.on('POST', `${P}/{rfiId}/open`, () => ({ rfi: apiRfi(), responses: [] }));
    const opened = await createRfisApi('org_1').create(
      'prj_1',
      {
        subject: 'Lighting circuit in retail 2',
        question: 'Four downlights or six?',
        assigneeId: 'usr_elec',
        dueDate: '2026-10-09',
        distributionCompanyIds: [],
        costImpact: 'tbc',
        scheduleImpactDays: null,
        drawing: null,
        specSection: '0331',
        location: 'Retail 2',
        isPrivate: false,
      },
      actor,
      true,
    );
    const body = fake.callsTo('POST', P)[0]!.init.body;
    expect(body).toEqual({
      subject: 'Lighting circuit in retail 2',
      question: 'Four downlights or six?',
      assigneeIds: ['usr_elec'],
      dueDate: '2026-10-09',
      distributionCompanyIds: [],
      costImpact: 'tbc',
      isPrivate: false,
      specSection: '0331',
      location: 'Retail 2',
    });
    expect(fake.callsTo('POST', P)[0]!.init.params?.header).toHaveProperty('Idempotency-Key');
    expect(fake.callsTo('POST', `${P}/{rfiId}/open`)[0]!.init.params?.header).toEqual({
      'If-Match': '"1"',
    });
    expect(opened).toMatchObject({ status: 'open', number: 4 });
  });

  it('clears the spec section and location on edit, and leaves them out on create when empty', async () => {
    fake.on('POST', P, () => ({ rfi: apiRfi({ status: 'draft', version: 1 }), responses: [] }));
    fake.on('GET', `${P}/{rfiId}`, () => ({ rfi: apiRfi(), responses: [] }));
    fake.on('PATCH', `${P}/{rfiId}`, () => ({ rfi: apiRfi({ specSection: null }), responses: [] }));
    const input = {
      subject: 'S',
      question: 'Q',
      assigneeId: null,
      dueDate: null,
      distributionCompanyIds: [],
      costImpact: null,
      scheduleImpactDays: null,
      drawing: null,
      specSection: null,
      location: null,
      isPrivate: false,
    };
    const source = createRfisApi('org_1');
    await source.create('prj_1', input, actor, false);
    const created = fake.callsTo('POST', P)[0]!.init.body as Record<string, unknown>;
    expect(created).not.toHaveProperty('specSection');
    expect(created).not.toHaveProperty('location');
    await source.update('prj_1', 'rfi_1', input, actor);
    expect(fake.callsTo('PATCH', `${P}/{rfiId}`)[0]!.init.body).toMatchObject({
      specSection: null,
      location: null,
    });
  });

  it('shows the activity feed with who did what, and a due date change as before and after', async () => {
    fake.on('GET', `${P}/{rfiId}`, () => ({
      rfi: apiRfi(),
      responses: [
        {
          id: 'rfr_1',
          rfiId: 'rfi_1',
          authorId: 'usr_elec',
          body: 'Six.',
          fileIds: [],
          isOfficial: false,
          aiSuggestionId: 'ais_9',
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
    }));
    fake.on('GET', `${P}/{rfiId}/activity`, () => ({
      data: [
        { id: 'a1', kind: 'opened', at: '2026-10-01T00:00:00Z', actorId: 'usr_pm', details: {} },
        {
          id: 'a2',
          kind: 'updated',
          at: '2026-10-02T00:00:00Z',
          actorId: 'usr_pm',
          details: { changed: ['dueDate'], dueDate: ['2026-10-09', '2026-10-12'] },
        },
        {
          id: 'a3',
          kind: 'reopened',
          at: '2026-10-03T00:00:00Z',
          actorId: null,
          details: { reason: 'Wrong sheet' },
        },
      ],
    }));
    const rfi = await createRfisApi('org_1').get('prj_1', 'rfi_1');
    expect(rfi.responses[0]?.aiSuggestionId).toBe('ais_9');
    expect(rfi.activity).toEqual([
      { id: 'a1', actor: 'Dana Okafor', action: 'submitted the RFI', at: '2026-10-01T00:00:00Z' },
      {
        id: 'a2',
        actor: 'Dana Okafor',
        action: 'updated the RFI',
        before: '9 Oct 2026',
        after: '12 Oct 2026',
        at: '2026-10-02T00:00:00Z',
      },
      {
        id: 'a3',
        actor: 'Someone on an access link or the system',
        action: 'reopened the RFI',
        detail: 'Wrong sheet',
        at: '2026-10-03T00:00:00Z',
      },
    ]);
  });

  it('pins a new RFI to the chosen drawing revision and passes a Nova answer draft id on respond', async () => {
    fake.on('POST', P, () => ({ rfi: apiRfi({ status: 'draft', number: null }), responses: [] }));
    const source = createRfisApi('org_1');
    await source.create(
      'prj_1',
      {
        subject: 'S',
        question: 'Q',
        assigneeId: null,
        dueDate: null,
        distributionCompanyIds: [],
        costImpact: null,
        scheduleImpactDays: null,
        drawing: { sheetId: 'dsh_1', revisionId: 'drv_01M65EMFSJEDZRH3DXQVSTGVX5', label: 'A-001' },
        specSection: null,
        location: null,
        isPrivate: false,
      },
      actor,
      false,
    );
    expect(fake.callsTo('POST', P)[0]!.init.body).toMatchObject({
      pin: { drawingRevisionId: 'drv_01M65EMFSJEDZRH3DXQVSTGVX5' },
    });
    fake.on('POST', `${P}/{rfiId}/responses`, () => ({ rfi: apiRfi(), responses: [] }));
    await source.respond('prj_1', 'rfi_1', { body: ' Six. ', aiSuggestionId: 'ais_9' }, actor);
    expect(fake.callsTo('POST', `${P}/{rfiId}/responses`)[0]!.init.body).toEqual({
      body: 'Six.',
      aiSuggestionId: 'ais_9',
    });
  });

  it("drafts a response to an RFI with the person's direction, and lists the files Nova could not read", async () => {
    const AI = '/v1/orgs/{orgId}/projects/{projectId}/ai';
    fake.on('POST', `${AI}/rfis/{rfiId}/answer-drafts`, () => ({
      runId: 'air_2',
      suggestionId: 'ais_8',
      rfiId: 'rfi_1',
      answer: 'Use the 90 minute rating per spec 07 84 00.',
      basis: 'documents',
      needsDecision: ['Whether the rating changes the program.'],
      references: [
        {
          sourceType: 'document',
          sourceId: 'doc_1',
          revisionId: 'rev_1',
          page: 12,
          title: 'Specification',
          reference: '07 84 00',
          revision: null,
          quote: 'Fire stopping to achieve 90 minutes.',
        },
      ],
      unsupportedNumbers: ['14'],
      attachments: [
        { fileId: 'fil_1', name: 'photo.jpg', read: true },
        { fileId: 'fil_2', name: 'scan.pdf', read: false },
      ],
    }));
    const source = createRfisApi('org_1');
    const draft = await source.novaDraftResponse('prj_1', 'rfi_1', ' use the 90 minute rating ');
    expect(fake.callsTo('POST', `${AI}/rfis/{rfiId}/answer-drafts`)[0]!.init.body).toEqual({
      direction: 'use the 90 minute rating',
    });
    expect(draft).toMatchObject({
      id: 'ais_8',
      text: 'Use the 90 minute rating per spec 07 84 00.',
      basis: 'documents',
      needsDecision: ['Whether the rating changes the program.'],
      unsupportedNumbers: ['14'],
      unreadFiles: ['scan.pdf'],
      references: [{ kind: 'document', sourceId: 'doc_1', label: '07 84 00' }],
    });
    await source.novaDraftResponse('prj_1', 'rfi_1');
    expect(fake.callsTo('POST', `${AI}/rfis/{rfiId}/answer-drafts`)[1]!.init.body).toEqual({});
  });

  it('drafts an RFI from a note, and records the draft as edited when the person changed it', async () => {
    const AI = '/v1/orgs/{orgId}/projects/{projectId}/ai';
    fake.on('POST', `${AI}/rfi-drafts`, () => ({
      runId: 'air_1',
      suggestionId: 'ais_7',
      subject: 'Slab edge at grid C',
      question: 'Is the edge detail on S-201 Rev B correct?',
      discipline: 'structural',
      references: [
        {
          sourceType: 'drawing',
          sourceId: 'dsh_1',
          revisionId: 'drv_1',
          revision: 'B',
          title: 'Slab plan',
          reference: 'S-201',
          page: 1,
          quote: 'edge detail',
        },
      ],
      gaps: ['location'],
      unsupportedNumbers: ['150'],
      similarRfis: [{ id: 'rfi_9', number: 'RFI-009', subject: 'Slab edge', status: 'open' }],
      suggestedAssigneeIds: [],
      drawing: {
        drawingRevisionId: 'drv_1',
        sheetNumber: 'S-201',
        title: 'Slab plan',
        rev: 'B',
        pin: { x: 0.2, y: 0.7 },
        scanned: false,
      },
    }));
    const source = createRfisApi('org_1');
    const d = await source.novaDraftRfi('prj_1', ' slab edge looks wrong ');
    expect(fake.callsTo('POST', `${AI}/rfi-drafts`)[0]!.init.body).toEqual({
      note: 'slab edge looks wrong',
    });
    expect(d).toMatchObject({
      suggestionId: 'ais_7',
      gaps: ['location'],
      unsupportedNumbers: ['150'],
      references: [{ kind: 'drawing', label: 'S-201 Rev B', quote: 'edge detail' }],
      drawing: { revisionId: 'drv_1', label: 'S-201 Rev B', x: 0.2, y: 0.7 },
    });

    fake.on('POST', P, () => ({ rfi: apiRfi({ status: 'draft', number: null }), responses: [] }));
    fake.on('POST', `${AI}/suggestions/{suggestionId}/decision`, () => ({ id: 'ais_7' }));
    await source.create(
      'prj_1',
      {
        subject: 'Slab edge at grid C',
        question: 'Changed wording.',
        assigneeId: null,
        dueDate: null,
        distributionCompanyIds: [],
        costImpact: null,
        scheduleImpactDays: null,
        drawing: {
          sheetId: '',
          revisionId: 'drv_1',
          label: 'S-201 Rev B',
          pin: { x: 0.2, y: 0.7 },
        },
        specSection: null,
        location: null,
        isPrivate: false,
        nova: { suggestionId: 'ais_7', subject: 'Slab edge at grid C', question: 'Original.' },
      },
      actor,
      false,
    );
    expect(fake.callsTo('POST', P)[0]!.init.body).toMatchObject({
      aiSuggestionId: 'ais_7',
      pin: { drawingRevisionId: 'drv_1', x: 0.2, y: 0.7 },
    });
    expect(fake.callsTo('POST', `${AI}/suggestions/{suggestionId}/decision`)[0]!.init.body).toEqual(
      {
        decision: 'edited',
      },
    );
  });
});
