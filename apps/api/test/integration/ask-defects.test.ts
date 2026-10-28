import { PDFDocument } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
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
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Tilers R Us',
  );
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
  const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
  const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-101',
    title: 'Level 3',
    rev: 'A',
    fileId,
  });
  await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
  const pin = { drawingRevisionId: rev.json().id as string, x: 0.4, y: 0.6 };
  return { pm, sub, org, project, base, subCo, pin };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A draft defect assigned to the subcontractor; `issue` sends it. */
async function draftDefect(s: Setup, title: string, description: string) {
  const res = await s.pm.browser.post(`${s.base}/defects`, {
    title,
    description,
    priority: 'high',
    trade: 'tiling',
    assigneeCompanyId: s.subCo.companyId,
    pin: s.pin,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().defect.id as string, etag: etagOf(res) };
}

async function transition(
  who: Browser,
  s: Setup,
  id: string,
  etag: string,
  action: string,
  reason?: string,
) {
  const res = await who.post(
    `${s.base}/defects/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    { 'if-match': etag },
  );
  expect(res.statusCode, res.body).toBe(200);
  return etagOf(res);
}

async function issuedDefect(s: Setup, title: string, description: string) {
  const d = await draftDefect(s, title, description);
  return { id: d.id, etag: await transition(s.pm.browser, s, d.id, d.etag, 'issue') };
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

describe('Ask Nova answers from defects (F2)', () => {
  it('cites an issued defect, and never retrieves a draft or a voided one', async () => {
    const s = await setup('def-ask');
    const tile = await issuedDefect(
      s,
      'Bathroom 302 finishes',
      'Grout is missing around the shower waste.',
    );
    await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    await draftDefect(s, 'Roof flashing', 'Flashing is loose. CANARY-DRAFT-7712');
    const gone = await issuedDefect(s, 'Stair balustrade', 'Rail is loose. CANARY-VOID-4408');
    await transition(s.pm.browser, s, gone.id, gone.etag, 'void', 'Raised twice');

    expect(await index(s)).toMatchObject({
      rfisIndexed: 0,
      defectsIndexed: 2,
      defectsUnchanged: 0,
    });
    // Running it again does nothing new.
    expect(await index(s)).toMatchObject({ defectsIndexed: 0, defectsUnchanged: 2 });

    const res = await ask(s.pm.browser, s, 'Where is grout missing around the shower?');
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.found).toBe(true);
    expect(a.answer).toContain('Grout is missing around the shower waste');
    expect(a.citations).toEqual([
      expect.objectContaining({
        sourceType: 'defect',
        sourceId: tile.id,
        revisionId: tile.id,
        revision: 'open',
        title: 'Bathroom 302 finishes',
        reference: 'DEF-0001',
        page: 1,
        quote: expect.stringContaining('Grout is missing'),
      }),
    ]);

    // A never-issued draft and a withdrawn defect are not in the project's record.
    for (const q of ['Is the roof flashing loose?', 'Is the stair balustrade rail loose?']) {
      const none = await ask(s.pm.browser, s, q);
      expect(none.statusCode).toBe(200);
      expect(none.json(), q).toMatchObject({ found: false, citations: [] });
    }
    expect(seenByModel()).not.toMatch(/CANARY/);
  });

  it('indexes a defect again when it changes, and drops the old text', async () => {
    const s = await setup('def-reindex');
    const d = await issuedDefect(
      s,
      'Ensuite tiles',
      'Spirit level shows the floor tiles lipping at the doorway.',
    );
    expect(await index(s)).toMatchObject({ defectsIndexed: 1 });

    // The subcontractor disputes it, with a reason that becomes part of the record.
    await transition(
      s.sub.browser,
      s,
      d.id,
      d.etag,
      'dispute',
      'The substrate was out of level when we started, not our work.',
    );
    expect(await index(s)).toMatchObject({ defectsIndexed: 1, defectsUnchanged: 0 });

    const a = (
      await ask(s.pm.browser, s, 'Why was the substrate out of level when they started?')
    ).json();
    expect(a.found).toBe(true);
    expect(a.answer).toContain('substrate was out of level');
    expect(a.citations[0]).toMatchObject({
      sourceType: 'defect',
      sourceId: d.id,
      revision: 'disputed',
    });

    // One revision is left: the open one's chunks and index entry are gone.
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
      tx.execute(sql`select count(*)::int as n, count(distinct revision_id)::int as revisions,
                            min(revision_label) as label
                     from ai.ai_chunks
                     where project_id = ${projectId} and source_type = 'defect'`),
    );
    const entries = await t.adminDb.withTenantTx(ctx, ({ tx }) =>
      tx.execute(sql`select count(*)::int as n from ai.ai_index_entries
                     where project_id = ${projectId} and source_type = 'defect'`),
    );
    expect(chunks.rows[0]).toEqual({ n: 1, revisions: 1, label: 'disputed' });
    expect(entries.rows[0]).toEqual({ n: 1 });
  });

  it('is for builder staff: the company a defect is assigned to gets nothing from Ask or search, and no defect text reaches the model', async () => {
    const s = await setup('def-scope');
    const d = await issuedDefect(
      s,
      'Plant room door',
      'The plant room door swings the wrong way. CANARY-SCOPE-9051',
    );
    await index(s);

    const question = 'Which way does the plant room door swing?';
    // The subcontractor can open the defect in the register but Ask does not retrieve defects for them.
    expect((await s.sub.browser.get(`${s.base}/defects/${d.id}`)).statusCode).toBe(200);
    const from = t.ai.calls.length;
    const theirs = await ask(s.sub.browser, s, question);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });
    const theirSearch = await search(s.sub.browser, s, 'plant room door swings');
    expect(theirSearch.statusCode).toBe(200);
    expect(theirSearch.json()).toEqual({ results: [] });
    expect(seenByModel(from)).not.toContain('CANARY-SCOPE-9051');

    const mine = (await ask(s.pm.browser, s, question)).json();
    expect(mine.found).toBe(true);
    expect(mine.answer).toContain('swings the wrong way');
    const found = (await search(s.pm.browser, s, 'plant room door swings')).json();
    expect(found.results).toEqual([
      expect.objectContaining({
        sourceType: 'defect',
        sourceId: d.id,
        reference: 'DEF-0001',
        snippet: expect.stringContaining('swings'),
      }),
    ]);

    // Only admins can index.
    expect((await s.sub.browser.post(`${s.base}/ai/index`)).statusCode).toBe(403);
  });
});
