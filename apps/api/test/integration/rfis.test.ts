import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'rfi-pm');
  const eng = await signUp(t.app, 'rfi-eng');
  const sub = await signUp(t.app, 'rfi-sub');
  const outsider = await signUp(t.app, 'rfi-plumber');
  const org = await createOrg(pm.browser, 'RFI Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower C', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const engCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    eng.email,
    'Consultant',
    'Smith Engineers',
  );
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky',
  );
  await addMember(pm.browser, org.id, project.id, outsider.email, 'Subcontractor', 'Plumbco');
  return { pm, eng, sub, outsider, org, project, base, engCo, subCo };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('RFI lifecycle (product/03)', () => {
  it('drafts, opens with a number and default due date, answers, closes and reopens', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Slab edge detail at grid C4',
      question: 'Drawing S-201 and A-101 disagree on the slab edge setback. Which governs?',
      assigneeIds: [s.eng.userId],
      distributionCompanyIds: [s.subCo.companyId],
      costImpact: 'tbc',
      specSection: '  03 30 00 Cast-in-place concrete ',
      location: 'Level 2, gridline C',
    });
    expect(draft.statusCode).toBe(201);
    const rfi = draft.json().rfi;
    expect(rfi).toMatchObject({
      status: 'draft',
      number: null,
      managerId: s.pm.userId,
      specSection: '03 30 00 Cast-in-place concrete',
      location: 'Level 2, gridline C',
    });

    const opened = await s.pm.browser.post(`${s.base}/rfis/${rfi.id}/open`, undefined, {
      'if-match': etagOf(draft),
    });
    expect(opened.statusCode).toBe(200);
    const o = opened.json().rfi;
    expect(o).toMatchObject({
      status: 'open',
      number: 1,
      numberLabel: 'RFI-001',
      ballInCourt: { side: 'assignees', userIds: [s.eng.userId] },
      isOverdue: false,
    });
    expect(o.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The ball's start is tracked: set when sent, moved when answered, null when nobody holds it.
    expect(Date.parse(o.ballInCourt.since)).not.toBeNaN();
    const due = new Date(`${o.dueDate}T00:00:00Z`).getUTCDay();
    expect([0, 6]).not.toContain(due);

    // The distributed subcontractor can see it but not answer it; an unrelated subcontractor can't see it.
    expect((await s.sub.browser.get(`${s.base}/rfis/${rfi.id}`)).statusCode).toBe(200);
    expect((await s.outsider.browser.get(`${s.base}/rfis/${rfi.id}`)).statusCode).toBe(404);
    expect((await s.outsider.browser.get(`${s.base}/rfis`)).json().data).toEqual([]);
    const subAnswer = await s.sub.browser.post(`${s.base}/rfis/${rfi.id}/responses`, {
      body: 'Hmm',
    });
    expect(subAnswer.json().code).toBe('rfi.response_not_allowed');

    const sketch = await uploadFile(t, s.eng.browser, s.org.id, s.project.id, 'sketch.pdf', 'rfis');
    const answered = await s.eng.browser.post(`${s.base}/rfis/${rfi.id}/responses`, {
      body: 'S-201 governs. Setback is 150 mm.',
      fileIds: [sketch],
    });
    expect(answered.statusCode).toBe(201);
    const a = answered.json();
    expect(a.rfi).toMatchObject({
      status: 'answered',
      ballInCourt: { side: 'builder', userIds: [s.pm.userId] },
    });
    expect(Date.parse(a.rfi.ballInCourt.since)).toBeGreaterThanOrEqual(
      Date.parse(o.ballInCourt.since),
    );
    expect(a.responses[0]).toMatchObject({ authorId: s.eng.userId, fileIds: [sketch] });

    const waiting = (await s.pm.browser.get(`${s.base}/rfis?ballInCourt=${s.pm.userId}`)).json()
      .data;
    expect(waiting.map((x: { id: string }) => x.id)).toEqual([rfi.id]);

    // Consultants can't close; the PM closes with the official answer.
    expect(
      (
        await s.eng.browser.post(
          `${s.base}/rfis/${rfi.id}/close`,
          { officialResponseId: a.responses[0].id },
          { 'if-match': etagOf(answered) },
        )
      ).statusCode,
    ).toBe(403);
    const closed = await s.pm.browser.post(
      `${s.base}/rfis/${rfi.id}/close`,
      { officialResponseId: a.responses[0].id },
      { 'if-match': etagOf(answered) },
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().rfi).toMatchObject({
      status: 'closed',
      officialResponseId: a.responses[0].id,
    });
    expect(closed.json().responses[0].isOfficial).toBe(true);

    const reopened = await s.pm.browser.post(
      `${s.base}/rfis/${rfi.id}/reopen`,
      { reason: 'Architect disagrees' },
      { 'if-match': etagOf(closed) },
    );
    expect(reopened.json().rfi).toMatchObject({
      status: 'open',
      officialResponseId: null,
      ballInCourt: { side: 'assignees' },
    });
    expect(reopened.json().responses[0].isOfficial).toBe(false);

    const voided = await s.pm.browser.post(
      `${s.base}/rfis/${rfi.id}/void`,
      { reason: 'Superseded by RFI-002' },
      { 'if-match': etagOf(reopened) },
    );
    expect(voided.json().rfi).toMatchObject({
      status: 'void',
      voidReason: 'Superseded by RFI-002',
    });
    const again = await s.pm.browser.post(
      `${s.base}/rfis/${rfi.id}/reopen`,
      { reason: 'x' },
      { 'if-match': etagOf(voided) },
    );
    expect(again.json().code).toBe('rfi.invalid_transition');

    // The activity feed lists the lifecycle oldest first, with the who and the before/after of an update.
    const feed = (await s.pm.browser.get(`${s.base}/rfis/${rfi.id}/activity`)).json().data;
    expect(feed.map((e: { kind: string }) => e.kind)).toEqual([
      'created',
      'opened',
      'answered',
      'closed',
      'reopened',
      'voided',
    ]);
    expect(feed[2]).toMatchObject({
      actorId: s.eng.userId,
      details: { responseId: a.responses[0].id },
    });
    expect(feed[5].details.reason).toBe('Superseded by RFI-002');
    expect((await s.outsider.browser.get(`${s.base}/rfis/${rfi.id}/activity`)).statusCode).toBe(
      404,
    );
  });

  it('keeps the spec section and location as written, trimmed, clearable and capped', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Spec and place',
      specSection: '  03 30 00 Cast-in-place concrete ',
      location: 'Level 2, gridline C',
    });
    expect(draft.json().rfi).toMatchObject({
      specSection: '03 30 00 Cast-in-place concrete',
      location: 'Level 2, gridline C',
    });
    const rfi = draft.json().rfi;
    const cleared = await s.pm.browser.patch(
      `${s.base}/rfis/${rfi.id}`,
      { specSection: '  ', location: null },
      { 'if-match': etagOf(draft) },
    );
    expect(cleared.json().rfi).toMatchObject({ specSection: null, location: null });
    const tooLong = await s.pm.browser.patch(
      `${s.base}/rfis/${rfi.id}`,
      { location: 'x'.repeat(201) },
      { 'if-match': etagOf(cleared) },
    );
    expect(tooLong.statusCode).toBe(422);
  });

  it('pins to a sheet with or without a position, and records the Nova suggestion on a response', async () => {
    const s = await setup();
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name: 'IFC' })).json();
    const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await doc.save());
    const rev = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'S-201',
      title: 'Slab',
      rev: 'A',
      fileId,
    });
    await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
    const drawingRevisionId = rev.json().id as string;

    const sheetOnly = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Slab edge',
      question: 'Which setback governs?',
      assigneeIds: [s.eng.userId],
      pin: { drawingRevisionId },
    });
    expect(sheetOnly.statusCode).toBe(201);
    expect(sheetOnly.json().rfi.pin).toEqual({ drawingRevisionId, x: null, y: null });
    const marked = await s.pm.browser.patch(
      `${s.base}/rfis/${sheetOnly.json().rfi.id}`,
      { pin: { drawingRevisionId, x: 0.25, y: 0.5 } },
      { 'if-match': etagOf(sheetOnly) },
    );
    expect(marked.json().rfi.pin).toEqual({ drawingRevisionId, x: 0.25, y: 0.5 });
    const half = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Half a pin',
      pin: { drawingRevisionId, x: 0.1 },
    });
    expect(half.statusCode).toBe(422);

    const opened = await s.pm.browser.post(
      `${s.base}/rfis/${sheetOnly.json().rfi.id}/open`,
      undefined,
      {
        'if-match': etagOf(marked),
      },
    );
    expect(opened.statusCode).toBe(200);
    const suggestionId = `ais_${'0'.repeat(26)}`;
    const answered = await s.eng.browser.post(
      `${s.base}/rfis/${sheetOnly.json().rfi.id}/responses`,
      {
        body: 'Drafted by Nova, checked by me.',
        aiSuggestionId: suggestionId,
      },
    );
    expect(answered.statusCode).toBe(201);
    expect(answered.json().responses[0].aiSuggestionId).toBe(suggestionId);
  });

  it('refuses to open an incomplete RFI and never reuses numbers', async () => {
    const s = await setup();
    const bare = await s.pm.browser.post(`${s.base}/rfis`, { subject: 'Missing bits' });
    const res = await s.pm.browser.post(`${s.base}/rfis/${bare.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(bare),
    });
    expect(res.statusCode).toBe(422);
    expect(
      res
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['assigneeIds', 'question']);

    const numbers: number[] = [];
    for (const subject of ['One', 'Two']) {
      const d = await s.pm.browser.post(`${s.base}/rfis`, {
        subject,
        question: 'Q?',
        assigneeIds: [s.eng.userId],
        dueDate: '2030-01-10',
      });
      const o = await s.pm.browser.post(`${s.base}/rfis/${d.json().rfi.id}/open`, undefined, {
        'if-match': etagOf(d),
      });
      numbers.push(o.json().rfi.number);
    }
    expect(numbers).toEqual([1, 2]);
  });

  it("keeps a subcontractor's draft with their company until the builder sends it", async () => {
    const s = await setup();
    const d = await s.sub.browser.post(`${s.base}/rfis`, {
      subject: 'Cable tray clash',
      question: 'Tray clashes with duct at L3.',
    });
    expect(d.statusCode).toBe(201);
    expect(d.json().rfi).toMatchObject({ raisedByCompanyId: s.subCo.companyId, managerId: null });
    // Subcontractors can't send RFIs to consultants themselves.
    const self = await s.sub.browser.post(`${s.base}/rfis/${d.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(d),
    });
    expect(self.statusCode).toBe(403);
    expect((await s.eng.browser.get(`${s.base}/rfis/${d.json().rfi.id}`)).statusCode).toBe(404);

    const pmView = await s.pm.browser.get(`${s.base}/rfis/${d.json().rfi.id}`);
    const edited = await s.pm.browser.patch(
      `${s.base}/rfis/${d.json().rfi.id}`,
      {
        assigneeIds: [s.eng.userId],
        question: 'Cable tray clashes with the supply duct at L3 grid D.',
      },
      { 'if-match': etagOf(pmView) },
    );
    const sent = await s.pm.browser.post(`${s.base}/rfis/${d.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(edited),
    });
    expect(sent.json().rfi.status).toBe('open');
    // The raising subcontractor still sees it; the assigned consultant now does too.
    expect((await s.sub.browser.get(`${s.base}/rfis/${d.json().rfi.id}`)).statusCode).toBe(200);
    expect((await s.eng.browser.get(`${s.base}/rfis/${d.json().rfi.id}`)).statusCode).toBe(200);
  });

  it('keeps private RFIs internal and rejects assignees who are not on the project', async () => {
    const s = await setup();
    const stranger = await signUp(t.app, 'rfi-stranger');
    const bad = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'x',
      assigneeIds: [stranger.userId],
    });
    expect(bad.json().code).toBe('rfi.assignee_not_on_project');

    const d = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Internal',
      question: 'Builder only',
      assigneeIds: [s.eng.userId],
      distributionCompanyIds: [s.subCo.companyId],
      isPrivate: true,
      dueDate: '2030-01-10',
    });
    await s.pm.browser.post(`${s.base}/rfis/${d.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(d),
    });
    expect((await s.sub.browser.get(`${s.base}/rfis/${d.json().rfi.id}`)).statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/rfis`)).json().data).toEqual([]);
  });
});

const PHOTO = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const RECT = (id: string) => ({
  id,
  kind: 'rect',
  from: { x: 0.1, y: 0.1 },
  to: { x: 0.4, y: 0.3 },
  color: '#D92D20',
  strokeWidth: 2,
});

describe('RFI photos and annotation', () => {
  it('attaches photos to the question, and keeps one mark layer per person per photo', async () => {
    const s = await setup();
    const photo = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      PHOTO,
      'crack.png',
      'image/png',
    );
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Crack in slab edge',
      question: 'Is this crack acceptable?',
      assigneeIds: [s.eng.userId],
      fileIds: [photo],
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().rfi.fileIds).toEqual([photo]);
    const id = draft.json().rfi.id;
    const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
      'if-match': etagOf(draft),
    });
    expect(opened.statusCode).toBe(200);

    // The raiser circles the crack; the consultant adds an arrow in their own layer.
    const mine = await s.pm.browser.put(`${s.base}/rfis/${id}/files/${photo}/annotation`, {
      shapes: [RECT('a1')],
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().annotation).toMatchObject({ authorId: s.pm.userId, fileId: photo });
    const theirs = await s.eng.browser.put(`${s.base}/rfis/${id}/files/${photo}/annotation`, {
      shapes: [{ id: 'b1', kind: 'arrow', from: { x: 0.8, y: 0.8 }, to: { x: 0.5, y: 0.3 } }],
    });
    expect(theirs.statusCode).toBe(200);

    // Saving again replaces the caller's layer only.
    await s.pm.browser.put(`${s.base}/rfis/${id}/files/${photo}/annotation`, {
      shapes: [RECT('a1'), RECT('a2')],
    });
    // The subcontractor isn't on this RFI, so its marks are hidden from them entirely.
    expect((await s.sub.browser.get(`${s.base}/rfis/${id}/annotations`)).statusCode).toBe(404);
    const all = (await s.eng.browser.get(`${s.base}/rfis/${id}/annotations`)).json().data;
    expect(all).toHaveLength(2);
    const pmLayer = all.find((a: { authorId: string }) => a.authorId === s.pm.userId);
    expect(pmLayer.shapes.map((x: { id: string }) => x.id)).toEqual(['a1', 'a2']);
    expect(pmLayer.shapes[0]).toMatchObject({ color: '#D92D20', strokeWidth: 2 });

    // An empty list removes the caller's layer and nobody else's.
    const cleared = await s.eng.browser.put(`${s.base}/rfis/${id}/files/${photo}/annotation`, {
      shapes: [],
    });
    expect(cleared.json()).toEqual({ annotation: null });
    expect((await s.pm.browser.get(`${s.base}/rfis/${id}/annotations`)).json().data).toHaveLength(
      1,
    );
  });

  it('refuses marks on files that are not photos of this RFI, bad shapes, pins, and closed RFIs', async () => {
    const s = await setup();
    const photo = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      PHOTO,
      'a.png',
      'image/png',
    );
    const other = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      new Uint8Array([...PHOTO, 0]),
      'b.png',
      'image/png',
    );
    const sketch = await uploadFile(t, s.pm.browser, s.org.id, s.project.id, 'sketch.pdf', 'rfis');
    const created = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Photos',
      question: 'Look.',
      assigneeIds: [s.eng.userId],
      fileIds: [photo, sketch],
    });
    const id = created.json().rfi.id;
    const url = (f: string) => `${s.base}/rfis/${id}/files/${f}/annotation`;

    const notOnRfi = await s.pm.browser.put(url(other), { shapes: [RECT('a')] });
    expect(notOnRfi.statusCode).toBe(422);
    expect(notOnRfi.json().code).toBe('rfi.photo_not_markable');
    const notImage = await s.pm.browser.put(url(sketch), { shapes: [RECT('a')] });
    expect(notImage.json().code).toBe('rfi.photo_not_markable');
    const pin = await s.pm.browser.put(url(photo), {
      shapes: [{ id: 'p', kind: 'pin', at: { x: 0.5, y: 0.5 }, entityType: 'rfi', entityId: 'x' }],
    });
    expect(pin.statusCode).toBe(422);
    const offSheet = await s.pm.browser.put(url(photo), {
      shapes: [{ ...RECT('a'), to: { x: 1.4, y: 0.3 } }],
    });
    expect(offSheet.statusCode).toBe(422);
    const badColour = await s.pm.browser.put(url(photo), {
      shapes: [{ ...RECT('a'), color: 'red' }],
    });
    expect(badColour.statusCode).toBe(422);

    // Someone who can't see the RFI can't mark it up either.
    const hidden = await s.outsider.browser.put(url(photo), { shapes: [RECT('a')] });
    expect(hidden.statusCode).toBe(404);

    // Photos added in a response can be marked up too; a closed RFI is frozen.
    const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
      'if-match': etagOf(await s.pm.browser.get(`${s.base}/rfis/${id}`)),
    });
    expect(opened.statusCode).toBe(200);
    const answered = await s.eng.browser.post(`${s.base}/rfis/${id}/responses`, {
      body: 'Fine.',
      fileIds: [other],
    });
    expect(answered.statusCode).toBe(201);
    expect((await s.eng.browser.put(url(other), { shapes: [RECT('a')] })).statusCode).toBe(200);
    const closed = await s.pm.browser.post(
      `${s.base}/rfis/${id}/close`,
      { officialResponseId: answered.json().responses[0].id },
      { 'if-match': etagOf(answered) },
    );
    expect(closed.statusCode).toBe(200);
    const frozen = await s.eng.browser.put(url(other), { shapes: [RECT('b')] });
    expect(frozen.statusCode).toBe(409);
  });
});

describe('RFI import (X49)', () => {
  it('keeps the original number, is idempotent on sourceRef and moves the counter on', async () => {
    const s = await setup();
    const orgId = decodeId('org', s.org.id)!;
    const projectId = decodeId('project', s.project.id)!;
    const ctx = {
      orgId,
      userId: decodeId('user', s.pm.userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'import',
    };
    const input = {
      sourceRef: 'aconex:RFI-0042',
      number: 42,
      subject: 'Imported question',
      question: 'From the old system',
      status: 'closed' as const,
      openedAt: new Date('2025-03-01T00:00:00Z'),
      closedAt: new Date('2025-03-08T00:00:00Z'),
      responses: [
        {
          body: 'Answer',
          authorName: 'J. Smith',
          createdAt: new Date('2025-03-05T00:00:00Z'),
          isOfficial: true,
        },
      ],
      importJobId: uuidv7(),
    };
    const first = await t.database.withTenantTx(ctx, (scope) =>
      t.modules.rfis.api.importRfi(scope, projectId, input),
    );
    const second = await t.database.withTenantTx(ctx, (scope) =>
      t.modules.rfis.api.importRfi(scope, projectId, input),
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });

    const list = (await s.pm.browser.get(`${s.base}/rfis?status=closed`)).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 42, numberLabel: 'RFI-042' });
    expect(list[0].openedAt).toBe('2025-03-01T00:00:00.000Z');

    const d = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'New',
      question: 'Q',
      assigneeIds: [s.eng.userId],
      dueDate: '2030-01-10',
    });
    const o = await s.pm.browser.post(`${s.base}/rfis/${d.json().rfi.id}/open`, undefined, {
      'if-match': etagOf(d),
    });
    expect(o.json().rfi.number).toBe(43);
  });
});
