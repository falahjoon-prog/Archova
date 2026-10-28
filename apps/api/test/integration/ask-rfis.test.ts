import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const eng = await signUp(t.app, `${label}-eng`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Engineers');
  return { pm, eng, org, project, base };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A sent RFI (numbered, open) with the consultant asked. */
async function sendRfi(s: Setup, subject: string, question: string) {
  const draft = await s.pm.browser.post(`${s.base}/rfis`, {
    subject,
    question,
    assigneeIds: [s.eng.userId],
  });
  expect(draft.statusCode).toBe(201);
  const id = draft.json().rfi.id as string;
  const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
    'if-match': etagOf(draft),
  });
  expect(opened.statusCode).toBe(200);
  return { id, etag: etagOf(opened) };
}

async function respond(who: Browser, s: Setup, id: string, body: string) {
  const res = await who.post(`${s.base}/rfis/${id}/responses`, { body });
  expect(res.statusCode).toBe(201);
  return { etag: etagOf(res), responseId: res.json().responses.at(-1).id as string };
}

async function close(s: Setup, id: string, etag: string, officialResponseId: string) {
  const res = await s.pm.browser.post(
    `${s.base}/rfis/${id}/close`,
    { officialResponseId },
    { 'if-match': etag },
  );
  expect(res.statusCode, res.body).toBe(200);
  return etagOf(res);
}

const ask = (b: Browser, s: Setup, question: string) => b.post(`${s.base}/ai/ask`, { question });
const index = async (s: Setup) => (await s.pm.browser.post(`${s.base}/ai/index`)).json();

/** Every passage any model call has seen, to prove text that must not be retrieved never reached the model. */
const seenByModel = (from = 0) =>
  t.ai.calls
    .slice(from)
    .flatMap((c) => c.passages.map((p) => p.text))
    .join('\n');

describe('Ask Nova answers from RFIs (F2)', () => {
  it('cites the official response of a sent RFI, and never answers from a comment, an unanswered RFI, a draft or a void one', async () => {
    const s = await setup('rfi-ask');

    const slab = await sendRfi(
      s,
      'Slab edge detail at grid C4',
      'Drawings S-201 and A-101 disagree on the slab edge setback at grid C4. Which governs?',
    );
    const eng = await respond(
      s.eng.browser,
      s,
      slab.id,
      'S-201 governs, so the slab edge setback at grid C4 is 150 mm.',
    );
    await close(s, slab.id, eng.etag, eng.responseId);

    const brick = await sendRfi(
      s,
      'Bay Street facade brick colour',
      'Which brick colour applies to the Bay Street facade?',
    );
    await respond(
      s.pm.browser,
      s,
      brick.id,
      'The architect said at the site meeting it might be dark grey, not confirmed.',
    );
    await sendRfi(s, 'Stair nosing', 'Can the stair nosing be a flush-fitting aluminium section?');

    // Never sent, and withdrawn: neither is indexed.
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Roof sheeting',
      question: 'Which roof sheeting profile applies? CANARY-DRAFT-5521',
    });
    expect(draft.statusCode).toBe(201);
    const gone = await sendRfi(s, 'Louvre size', 'What size are the louvres? CANARY-VOID-3380');
    const voided = await s.pm.browser.post(
      `${s.base}/rfis/${gone.id}/void`,
      { reason: 'Duplicate' },
      { 'if-match': gone.etag },
    );
    expect(voided.statusCode).toBe(200);

    expect(await index(s)).toMatchObject({
      indexed: 0,
      unchanged: 0,
      rfisIndexed: 3,
      rfisUnchanged: 0,
    });
    // Running it again does nothing new.
    expect(await index(s)).toMatchObject({ rfisIndexed: 0, rfisUnchanged: 3 });

    const from = t.ai.calls.length;
    const res = await ask(s.pm.browser, s, 'What is the slab edge setback at grid C4?');
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.found).toBe(true);
    expect(a.answer).toContain('150 mm');
    expect(a.citations).toEqual([
      expect.objectContaining({
        sourceType: 'rfi',
        sourceId: slab.id,
        revisionId: slab.id,
        revision: 'closed',
        title: 'Slab edge detail at grid C4',
        reference: 'RFI-001',
        page: 1,
        quote: expect.stringContaining('150 mm'),
      }),
    ]);
    // The model was told which text is the official response.
    expect(seenByModel(from)).toContain('Official response:\nS-201 governs');

    // A remark, an unanswered question and a never-sent draft are not answers.
    for (const q of [
      'What brick colour is the Bay Street facade?',
      'What did the architect decide about the stair nosing?',
      'Which roof sheeting profile applies?',
      'What size are the louvres?',
    ]) {
      const none = await ask(s.pm.browser, s, q);
      expect(none.statusCode).toBe(200);
      expect(none.json(), q).toMatchObject({ found: false, citations: [] });
    }
    expect(seenByModel()).not.toMatch(/CANARY/);
  });

  it('indexes an RFI again when a comment becomes the official response, and drops the old text', async () => {
    const s = await setup('rfi-reindex');
    const rfi = await sendRfi(
      s,
      'Bay Street facade brick colour',
      'Which brick colour applies to the Bay Street facade?',
    );
    const comment = await respond(
      s.eng.browser,
      s,
      rfi.id,
      'The facade brick colour is dark grey, to the architect.',
    );
    expect(await index(s)).toMatchObject({ rfisIndexed: 1, rfisUnchanged: 0 });
    const before = await ask(s.pm.browser, s, 'What is the facade brick colour?');
    expect(before.json().found).toBe(false);

    await close(s, rfi.id, comment.etag, comment.responseId);
    expect(await index(s)).toMatchObject({ rfisIndexed: 1, rfisUnchanged: 0 });

    const after = (await ask(s.pm.browser, s, 'What is the facade brick colour?')).json();
    expect(after.found).toBe(true);
    expect(after.citations[0]).toMatchObject({
      sourceType: 'rfi',
      sourceId: rfi.id,
      revision: 'closed',
    });

    // One revision of the RFI is left: the old chunks and index entry are gone.
    const orgId = decodeId('org', s.org.id)!;
    const projectId = decodeId('project', s.project.id)!;
    const res = await t.adminDb.withTenantTx(
      {
        orgId,
        userId: decodeId('user', s.pm.userId)!,
        principalType: 'member' as const,
        orgRole: 'owner' as const,
        entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
        requestId: 'test',
      },
      ({ tx }) =>
        tx.execute(sql`select count(*)::int as n, count(distinct revision_id)::int as revisions
                       from ai.ai_chunks
                       where project_id = ${projectId} and source_type = 'rfi'`),
    );
    const entries = await t.adminDb.withTenantTx(
      {
        orgId,
        userId: decodeId('user', s.pm.userId)!,
        principalType: 'member' as const,
        orgRole: 'owner' as const,
        entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
        requestId: 'test',
      },
      ({ tx }) =>
        tx.execute(sql`select count(*)::int as n from ai.ai_index_entries
                       where project_id = ${projectId} and source_type = 'rfi'`),
    );
    expect(res.rows[0]).toEqual({ n: 1, revisions: 1 });
    expect(entries.rows[0]).toEqual({ n: 1 });
  });

  it('is for builder staff: a consultant asked on the RFI gets nothing from Ask, and no RFI text reaches the model', async () => {
    const s = await setup('rfi-scope');
    const rfi = await sendRfi(
      s,
      'Plant room slab penetration',
      'Can a 300 mm sleeve pass through the plant room slab? CANARY-SCOPE-6104',
    );
    const reply = await respond(
      s.eng.browser,
      s,
      rfi.id,
      'Yes, a 300 mm sleeve is acceptable at the plant room slab. CANARY-SCOPE-6104',
    );
    await close(s, rfi.id, reply.etag, reply.responseId);
    await index(s);

    const question = 'Can a 300 mm sleeve pass through the plant room slab?';
    // The consultant can open the RFI in the register but Ask does not retrieve RFIs for them.
    expect((await s.eng.browser.get(`${s.base}/rfis/${rfi.id}`)).statusCode).toBe(200);
    const from = t.ai.calls.length;
    const theirs = await ask(s.eng.browser, s, question);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });
    expect(seenByModel(from)).not.toContain('CANARY-SCOPE-6104');

    const mine = (await ask(s.pm.browser, s, question)).json();
    expect(mine.found).toBe(true);
    expect(mine.answer).toContain('300 mm sleeve');

    // Only admins can index.
    expect((await s.eng.browser.post(`${s.base}/ai/index`)).statusCode).toBe(403);
  });
});
