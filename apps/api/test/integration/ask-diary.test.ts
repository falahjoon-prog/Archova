import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import { addDays, localDateOf } from '@archova/time';
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

const TZ = 'Australia/Brisbane';
const day = (daysAgo: number) => addDays(localDateOf(new Date(), TZ), -daysAgo);
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const sup = await signUp(t.app, `${label}-sup`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Formco',
  );
  await addMember(pm.browser, org.id, project.id, sup.email, 'Superintendent', 'Superintendent Co');
  return { pm, sm, sub, sup, org, project, base, subCo, diary: `${base}/diary` };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Makes a user who is a project member an organisation member too: builder staff, not a guest company. */
async function makeStaff(s: Setup, who: { userId: string }) {
  await t.adminDb.withTenantTx(
    {
      orgId: decodeId('org', s.org.id)!,
      userId: decodeId('user', s.pm.userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'test',
    },
    ({ tx }) =>
      tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status, joined_at)
                     values (${uuidv7()}, ${decodeId('org', s.org.id)!}, ${decodeId('user', who.userId)!}, 'member', 'active', now())`),
  );
}

/** A diary day with notes, labour and a delay, left as a draft. */
async function writeDay(s: Setup, date: string, notes: string, delay?: string) {
  const header = await s.sm.browser.put(`${s.diary}/${date}`, { notes });
  expect(header.statusCode, header.body).toBe(200);
  const labour = await s.sm.browser.post(`${s.diary}/${date}/labour`, {
    companyId: s.subCo.companyId,
    trade: 'Formwork',
    headcount: 6,
    hours: 45.5,
  });
  expect(labour.statusCode).toBe(201);
  if (delay) {
    const d = await s.sm.browser.post(`${s.diary}/${date}/delays`, {
      type: 'weather',
      description: delay,
      hours: 2,
    });
    expect(d.statusCode).toBe(201);
  }
  return etagOf(await s.sm.browser.get(`${s.diary}/${date}`));
}

async function submit(s: Setup, date: string, etag: string) {
  const res = await s.sm.browser.post(`${s.diary}/${date}/submit`, {}, { 'if-match': etag });
  expect(res.statusCode, res.body).toBe(200);
  return etagOf(res);
}

const ask = (b: Browser, s: Setup, question: string) => b.post(`${s.base}/ai/ask`, { question });
const search = (b: Browser, s: Setup, query: string) => b.post(`${s.base}/ai/search`, { query });
const index = async (s: Setup) => (await s.pm.browser.post(`${s.base}/ai/index`)).json();

/** Every passage any model call has seen, to prove text that must not be retrieved never reached the model. */
const seenByModel = (from = 0) =>
  t.ai.calls
    .slice(from)
    .flatMap((c) => c.passages.map((p) => p.text))
    .join('\n');

describe('Ask Nova answers from the site diary (F2)', () => {
  it('cites a submitted day with its date, and never retrieves a draft', async () => {
    const s = await setup('dia-ask');
    const date = day(3);
    const etag = await writeDay(
      s,
      date,
      'The tower crane was inspected by the engineer and passed.',
      'Heavy rain stopped the slab pour.',
    );
    await submit(s, date, etag);
    // A day still being written is not the record yet.
    await writeDay(s, day(2), 'Scaffold tag missing on the north side. CANARY-DRAFT-3392');

    expect(await index(s)).toMatchObject({ diaryIndexed: 1, diaryUnchanged: 0 });
    // Running it again does nothing new.
    expect(await index(s)).toMatchObject({ diaryIndexed: 0, diaryUnchanged: 1 });

    const res = await ask(s.pm.browser, s, 'Was the tower crane inspected and passed?');
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.found).toBe(true);
    expect(a.answer).toContain('tower crane was inspected');
    expect(a.citations).toEqual([
      expect.objectContaining({
        sourceType: 'diary',
        sourceId: expect.stringMatching(/^dia_/),
        revisionId: expect.stringMatching(/^dia_/),
        revision: 'submitted',
        title: expect.stringMatching(/^Site diary \w+day \d+ \w+ \d{4}$/),
        reference: date,
        page: 1,
      }),
    ]);
    expect(a.citations[0].sourceId).toBe(a.citations[0].revisionId);

    const none = await ask(s.pm.browser, s, 'Is a scaffold tag missing on the north side?');
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ found: false, citations: [] });
    expect(seenByModel()).not.toMatch(/CANARY/);

    // Search finds the day by what the labour and delays say.
    const found = (await search(s.pm.browser, s, 'rain stopped the slab pour')).json();
    expect(found.results).toEqual([
      expect.objectContaining({ sourceType: 'diary', reference: date }),
    ]);
  });

  it('indexes the day again when it is signed off or amended, and drops the old text', async () => {
    const s = await setup('dia-reindex');
    const date = day(4);
    const etag = await writeDay(s, date, 'Formwork to the lift core started.');
    const submitted = await submit(s, date, etag);
    expect(await index(s)).toMatchObject({ diaryIndexed: 1 });

    const signed = await s.pm.browser.post(`${s.diary}/${date}/sign-off`, undefined, {
      'if-match': submitted,
    });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(await index(s)).toMatchObject({ diaryIndexed: 1, diaryUnchanged: 0 });
    const a = (await ask(s.pm.browser, s, 'Which formwork started on the lift core?')).json();
    expect(a.found).toBe(true);
    expect(a.citations[0]).toMatchObject({ revision: 'signed off' });

    // A change after sign-off is an amendment: the new words replace the old.
    const amended = await s.sm.browser.put(
      `${s.diary}/${date}`,
      {
        notes: 'Formwork to the lift core started. Rebar delivery was rejected.',
        amendmentReason: 'Missed note',
      },
      { 'if-match': etagOf(signed) },
    );
    expect(amended.statusCode, amended.body).toBe(200);
    expect(await index(s)).toMatchObject({ diaryIndexed: 1, diaryUnchanged: 0 });
    const b = (await ask(s.pm.browser, s, 'Was the rebar delivery rejected?')).json();
    expect(b.found).toBe(true);
    expect(b.citations[0]).toMatchObject({ revision: 'submitted' });

    // One revision of the day is left: the old chunks and index entries are gone.
    const ctx = {
      orgId: decodeId('org', s.org.id)!,
      userId: decodeId('user', s.pm.userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'test',
    };
    const projectId = decodeId('project', s.project.id)!;
    const chunks = await t.adminDb.withTenantTx(ctx, ({ tx }) =>
      tx.execute(sql`select count(*)::int as n, count(distinct revision_id)::int as revisions
                     from ai.ai_chunks
                     where project_id = ${projectId} and source_type = 'diary'`),
    );
    const entries = await t.adminDb.withTenantTx(ctx, ({ tx }) =>
      tx.execute(sql`select count(*)::int as n from ai.ai_index_entries
                     where project_id = ${projectId} and source_type = 'diary'`),
    );
    expect(chunks.rows[0]).toEqual({ n: 1, revisions: 1 });
    expect(entries.rows[0]).toEqual({ n: 1 });
  });

  it('is for builder staff: a subcontractor gets nothing from Ask or search, and no diary text reaches the model', async () => {
    const s = await setup('dia-scope');
    const date = day(5);
    const etag = await writeDay(
      s,
      date,
      'Site manager note: the concrete pump was late. CANARY-SCOPE-7746',
    );
    await submit(s, date, etag);
    await index(s);
    await makeStaff(s, s.sm);

    const question = 'Was the concrete pump late?';
    // The subcontractor can read their own labour in the diary, but Ask does not retrieve the day for them.
    expect((await s.sub.browser.get(`${s.diary}/${date}`)).statusCode).toBe(200);
    const from = t.ai.calls.length;
    const theirs = await ask(s.sub.browser, s, question);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });
    const theirSearch = await search(s.sub.browser, s, 'concrete pump late');
    expect(theirSearch.statusCode).toBe(200);
    expect(theirSearch.json()).toEqual({ results: [] });
    expect(seenByModel(from)).not.toContain('CANARY-SCOPE-7746');

    // A superintendent reads the whole diary in the register, but is outside the organisation: no Ask scope for now.
    expect((await s.sup.browser.get(`${s.diary}/${date}`)).statusCode).toBe(200);
    const sup = await ask(s.sup.browser, s, question);
    expect(sup.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });
    expect((await search(s.sup.browser, s, 'concrete pump late')).json()).toEqual({ results: [] });
    expect(seenByModel(from)).not.toContain('CANARY-SCOPE-7746');

    // Even as an organisation member, a reader limited to their own company's labour holds no diary scope.
    await makeStaff(s, s.sub);
    const scoped = await ask(s.sub.browser, s, question);
    expect(scoped.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });
    expect((await search(s.sub.browser, s, 'concrete pump late')).json()).toEqual({ results: [] });
    expect(seenByModel(from)).not.toContain('CANARY-SCOPE-7746');

    // The site manager who wrote the day (builder staff, an organisation member) and the owner can ask.
    for (const who of [s.sm, s.pm]) {
      const mine = (await ask(who.browser, s, question)).json();
      expect(mine.found).toBe(true);
      expect(mine.citations[0]).toMatchObject({ sourceType: 'diary', reference: date });
    }
    expect((await s.sub.browser.post(`${s.base}/ai/index`)).statusCode).toBe(403);
  });
});
