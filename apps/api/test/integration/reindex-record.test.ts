import { PDFDocument } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MODULE_PERMISSIONS } from '@archova/compose';
import { decodeId } from '@archova/domain';
import { FOUNDATION_PERMISSIONS, buildRegistry } from '@archova/domain/permissions';
import { AI_INDEX_ACTOR } from '@archova/mod-ai';
import { addDays, localDateOf } from '@archova/time';
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

const TZ = 'Australia/Brisbane';
const day = (daysAgo: number) => addDays(localDateOf(new Date(), TZ), -daysAgo);
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builders`);
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Tilers R Us',
  );
  // A defect is pinned on a published sheet.
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
  return { pm, sm, sub, org, project, base, subCo, pin, diary: `${base}/diary` };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** What the ai-worker runs as: the org, the named system actor, and the plan's modules (Nova on unless `modules` says not). */
const systemCtx = (s: Setup, modules: string[] = ['ai'], orgRole: 'owner' | null = null) => ({
  orgId: decodeId('org', s.org.id)!,
  userId: AI_INDEX_ACTOR,
  principalType: 'member' as const,
  orgRole,
  entitlements: { plan: 'x', state: 'active' as const, modules, limits: {} },
  requestId: 'test',
});

const reindex = (
  s: Setup,
  kind: 'rfi' | 'defect' | 'diary',
  apiId: string,
  opts: { modules?: string[]; project?: string } = {},
) =>
  t.modules.ai.api.reindexRecord(
    systemCtx(s, opts.modules),
    decodeId('project', opts.project ?? s.project.id)!,
    kind,
    decodeId(kind, apiId)!,
  );

const ask = (b: Browser, s: Setup, question: string) => b.post(`${s.base}/ai/ask`, { question });
/** The records a search finds, by id. */
const found = async (b: Browser, s: Setup, query: string) => {
  const res = await b.post(`${s.base}/ai/search`, { query });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().results as Array<{ sourceId: string }>).map((r) => r.sourceId);
};
const index = async (s: Setup) => (await s.pm.browser.post(`${s.base}/ai/index`)).json();

const chunkRows = (s: Setup, sourceType: string) =>
  t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
    const res = await tx.execute<{ id: string; source_id: string; revision_id: string }>(
      sql`select id, source_id, revision_id from ai.ai_chunks
          where project_id = ${decodeId('project', s.project.id)!} and source_type = ${sourceType}
          order by id`,
    );
    return res.rows;
  });
const entryCount = (s: Setup, sourceType: string) =>
  t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
    const res = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ai.ai_index_entries
          where project_id = ${decodeId('project', s.project.id)!} and source_type = ${sourceType}`,
    );
    return res.rows[0]!.n;
  });

// ------------------------------------------------------------------------------------------------ defects

async function issuedDefect(s: Setup, title: string, description: string) {
  const res = await s.pm.browser.post(`${s.base}/defects`, {
    title,
    description,
    priority: 'high',
    trade: 'tiling',
    assigneeCompanyId: s.subCo.companyId,
    pin: s.pin,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().defect.id as string;
  const issued = await s.pm.browser.post(
    `${s.base}/defects/${id}/transition`,
    { action: 'issue' },
    { 'if-match': etagOf(res) },
  );
  expect(issued.statusCode, issued.body).toBe(200);
  return { id, etag: etagOf(issued) };
}

describe('Re-indexing one record after it changes', () => {
  it('drops a voided defect from search at once and leaves the other defects alone', async () => {
    const s = await setup('re-def');
    const grout = await issuedDefect(s, 'Bathroom 302 finishes', 'Grout is missing at the waste.');
    const paint = await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    expect(await index(s)).toMatchObject({ defectsIndexed: 2 });
    const before = await chunkRows(s, 'defect');
    const paintChunks = before.filter((c) => c.source_id === decodeId('defect', paint.id)!);
    expect(paintChunks).toHaveLength(1);

    const voided = await s.pm.browser.post(
      `${s.base}/defects/${grout.id}/transition`,
      { action: 'void', reason: 'Raised twice' },
      { 'if-match': grout.etag },
    );
    expect(voided.statusCode, voided.body).toBe(200);
    // Until the job runs the voided defect is still retrievable: this is the gap it closes.
    expect(await found(s.pm.browser, s, 'grout missing at the waste')).toContain(grout.id);

    expect(await reindex(s, 'defect', grout.id)).toEqual({ indexed: 0, unchanged: 0 });
    expect(await found(s.pm.browser, s, 'grout missing at the waste')).not.toContain(grout.id);
    // The other defect's chunks are the very rows they were, not embedded again.
    const after = await chunkRows(s, 'defect');
    expect(after).toEqual(paintChunks);
    expect(await entryCount(s, 'defect')).toBe(1);
  });

  it('indexes a new defect on its own, and does nothing the second time', async () => {
    const s = await setup('re-new');
    await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    await index(s);

    const door = await issuedDefect(s, 'Plant room door', 'The door swings the wrong way.');
    expect(await reindex(s, 'defect', door.id)).toEqual({ indexed: 1, unchanged: 0 });
    expect(await reindex(s, 'defect', door.id)).toEqual({ indexed: 0, unchanged: 1 });
    const a = (await ask(s.pm.browser, s, 'Which way does the plant room door swing?')).json();
    expect(a.found).toBe(true);
    expect(a.citations[0]).toMatchObject({ sourceType: 'defect', sourceId: door.id });
    // A full run finds nothing left to do.
    expect(await index(s)).toMatchObject({ defectsIndexed: 0, defectsUnchanged: 2 });
  });

  it('replaces a changed defect, and drops the old text even when Nova cannot run', async () => {
    const s = await setup('re-off');
    const tile = await issuedDefect(s, 'Ensuite tiles', 'Floor tiles are lipping at the doorway.');
    await index(s);

    const disputed = await s.sub.browser.post(
      `${s.base}/defects/${tile.id}/transition`,
      { action: 'dispute', reason: 'The substrate was out of level when we started.' },
      { 'if-match': tile.etag },
    );
    expect(disputed.statusCode, disputed.body).toBe(200);

    // The plan has no Nova: the old text still goes, and the new text is not indexed.
    await expect(reindex(s, 'defect', tile.id, { modules: [] })).rejects.toMatchObject({
      code: 'entitlement-required',
    });
    expect(await chunkRows(s, 'defect')).toEqual([]);
    expect(await entryCount(s, 'defect')).toBe(0);

    expect(await reindex(s, 'defect', tile.id)).toEqual({ indexed: 1, unchanged: 0 });
    const a = (await ask(s.pm.browser, s, 'Why was the substrate out of level?')).json();
    expect(a.found).toBe(true);
    expect(a.citations[0]).toMatchObject({ sourceId: tile.id, revision: 'disputed' });
    expect(await chunkRows(s, 'defect')).toHaveLength(1);
  });

  it('only touches the project and org the record is in', async () => {
    const a = await setup('re-scope-a');
    const b = await setup('re-scope-b');
    const grout = await issuedDefect(a, 'Bathroom 302 finishes', 'Grout is missing at the waste.');
    await index(a);
    const before = await chunkRows(a, 'defect');

    // Another project, or another org's project, naming the same record finds nothing to do and drops nothing.
    expect(await reindex(b, 'defect', grout.id)).toEqual({ indexed: 0, unchanged: 0 });
    expect(await reindex(a, 'defect', grout.id, { project: b.project.id })).toEqual({
      indexed: 0,
      unchanged: 0,
    });
    expect(await chunkRows(a, 'defect')).toEqual(before);
    expect(await chunkRows(b, 'defect')).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------- RFIs

  it('drops a voided RFI', async () => {
    const s = await setup('re-rfi');
    const draft = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Louvre size',
      question: 'What size are the louvres on the plant room?',
      assigneeIds: [s.sm.userId],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const id = draft.json().rfi.id as string;
    const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
      'if-match': etagOf(draft),
    });
    expect(opened.statusCode, opened.body).toBe(200);

    expect(await reindex(s, 'rfi', id)).toEqual({ indexed: 1, unchanged: 0 });
    // Asked and not yet answered, so Ask will not answer from it; search finds it.
    expect(await found(s.pm.browser, s, 'size of the louvres on the plant room')).toContain(id);

    const voided = await s.pm.browser.post(
      `${s.base}/rfis/${id}/void`,
      { reason: 'Duplicate' },
      { 'if-match': etagOf(opened) },
    );
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await reindex(s, 'rfi', id)).toEqual({ indexed: 0, unchanged: 0 });
    expect(await chunkRows(s, 'rfi')).toEqual([]);
    expect(await found(s.pm.browser, s, 'size of the louvres on the plant room')).not.toContain(id);
  });

  // ---------------------------------------------------------------------------------------------- diary

  it('indexes a diary day once it is submitted, never while it is a draft, and replaces it when amended', async () => {
    const s = await setup('re-dia');
    const date = day(3);
    const put = await s.sm.browser.put(`${s.diary}/${date}`, {
      notes: 'Formwork to the lift core started. CANARY-DRAFT-6613',
    });
    expect(put.statusCode, put.body).toBe(200);
    const detail = await s.sm.browser.get(`${s.diary}/${date}`);
    const entryId = detail.json().entry.id as string;

    // Saving a draft fires an event too; it must come to nothing.
    expect(await reindex(s, 'diary', entryId)).toEqual({ indexed: 0, unchanged: 0 });
    expect(await chunkRows(s, 'diary')).toEqual([]);

    const submitted = await s.sm.browser.post(
      `${s.diary}/${date}/submit`,
      {},
      {
        'if-match': etagOf(detail),
      },
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(await reindex(s, 'diary', entryId)).toEqual({ indexed: 1, unchanged: 0 });
    expect(await reindex(s, 'diary', entryId)).toEqual({ indexed: 0, unchanged: 1 });

    const signed = await s.pm.browser.post(`${s.diary}/${date}/sign-off`, undefined, {
      'if-match': etagOf(submitted),
    });
    expect(signed.statusCode, signed.body).toBe(200);
    const amended = await s.sm.browser.put(
      `${s.diary}/${date}`,
      {
        notes: 'Formwork to the lift core started. Rebar delivery was rejected.',
        amendmentReason: 'Missed note',
      },
      { 'if-match': etagOf(signed) },
    );
    expect(amended.statusCode, amended.body).toBe(200);
    expect(await reindex(s, 'diary', entryId)).toEqual({ indexed: 1, unchanged: 0 });

    const a = (await ask(s.pm.browser, s, 'Was the rebar delivery rejected?')).json();
    expect(a.found).toBe(true);
    // One revision of the day is left, and the full run agrees with it.
    expect(await chunkRows(s, 'diary')).toHaveLength(1);
    expect(await entryCount(s, 'diary')).toBe(1);
    expect(await index(s)).toMatchObject({ diaryIndexed: 0, diaryUnchanged: 1 });
  });

  // ------------------------------------------------------------------------------- dropping, and who the worker is

  const embedSpy = () => vi.spyOn(t.ai, 'embed');
  const requestCount = (s: Setup) =>
    t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
      const res = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ai.ai_requests where org_id = ${decodeId('org', s.org.id)!}`,
      );
      return res.rows[0]!.n;
    });
  const dropStale = (s: Setup, kind: 'rfi' | 'defect' | 'diary', apiId: string) =>
    t.modules.ai.api.dropStaleRecord(
      systemCtx(s, []),
      decodeId('project', s.project.id)!,
      kind,
      decodeId(kind, apiId)!,
    );

  it('drops a voided record with no model call, and for a plan without Nova', async () => {
    const s = await setup('re-drop');
    const grout = await issuedDefect(s, 'Bathroom 302 finishes', 'Grout is missing at the waste.');
    await index(s);
    const requests = await requestCount(s);
    const embed = embedSpy();

    const voided = await s.pm.browser.post(
      `${s.base}/defects/${grout.id}/transition`,
      { action: 'void', reason: 'Raised twice' },
      { 'if-match': grout.etag },
    );
    expect(voided.statusCode, voided.body).toBe(200);
    // The drop needs no Nova on the plan (`systemCtx(s, [])`): it is deleting, not embedding.
    expect(await dropStale(s, 'defect', grout.id)).toEqual({ isSource: false });
    expect(await chunkRows(s, 'defect')).toEqual([]);
    expect(await entryCount(s, 'defect')).toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(await requestCount(s)).toBe(requests);
    embed.mockRestore();
  });

  it('drops the old text of a changed record at once and leaves its new text for the re-index', async () => {
    const s = await setup('re-stale');
    const tile = await issuedDefect(s, 'Ensuite tiles', 'Floor tiles are lipping at the doorway.');
    await index(s);
    const disputed = await s.sub.browser.post(
      `${s.base}/defects/${tile.id}/transition`,
      { action: 'dispute', reason: 'The substrate was out of level when we started.' },
      { 'if-match': tile.etag },
    );
    expect(disputed.statusCode, disputed.body).toBe(200);
    const embed = embedSpy();

    expect(await dropStale(s, 'defect', tile.id)).toEqual({ isSource: true });
    expect(await chunkRows(s, 'defect')).toEqual([]);
    expect(embed).not.toHaveBeenCalled();

    expect(await reindex(s, 'defect', tile.id)).toEqual({ indexed: 1, unchanged: 0 });
    expect(await chunkRows(s, 'defect')).toHaveLength(1);
    // The spy sees the gateway's calls, so the silence above is real.
    expect(embed).toHaveBeenCalledTimes(1);
    embed.mockRestore();
  });

  // The embedding call takes a moment, and the record can change in it. The hook below runs the change at the point
  // where the old text has been read and is being embedded.
  const duringEmbed = (change: () => Promise<void>) => {
    const real = t.ai.embed.bind(t.ai);
    return vi.spyOn(t.ai, 'embed').mockImplementationOnce(async (...args) => {
      await change();
      return real(...args);
    });
  };

  it('writes nothing for a record voided while its text was being embedded', async () => {
    const s = await setup('re-race-void');
    const grout = await issuedDefect(s, 'Bathroom 302 finishes', 'Grout is missing at the waste.');
    const embed = duringEmbed(async () => {
      const voided = await s.pm.browser.post(
        `${s.base}/defects/${grout.id}/transition`,
        { action: 'void', reason: 'Raised twice' },
        { 'if-match': grout.etag },
      );
      expect(voided.statusCode, voided.body).toBe(200);
    });

    expect(await reindex(s, 'defect', grout.id)).toEqual({ indexed: 0, unchanged: 0 });
    expect(embed).toHaveBeenCalledTimes(1);
    // The voided text was embedded and then discarded: not stored, not found, not counted as indexed.
    expect(await chunkRows(s, 'defect')).toEqual([]);
    expect(await entryCount(s, 'defect')).toBe(0);
    expect(await found(s.pm.browser, s, 'grout missing at the waste')).not.toContain(grout.id);
    embed.mockRestore();
  });

  it('writes nothing for the old text of a record amended while it was being embedded', async () => {
    const s = await setup('re-race-amend');
    const tile = await issuedDefect(s, 'Ensuite tiles', 'Floor tiles are lipping at the doorway.');
    const embed = duringEmbed(async () => {
      const disputed = await s.sub.browser.post(
        `${s.base}/defects/${tile.id}/transition`,
        { action: 'dispute', reason: 'The substrate was out of level when we started.' },
        { 'if-match': tile.etag },
      );
      expect(disputed.statusCode, disputed.body).toBe(200);
    });

    expect(await reindex(s, 'defect', tile.id)).toEqual({ indexed: 0, unchanged: 0 });
    expect(await chunkRows(s, 'defect')).toEqual([]);
    expect(await entryCount(s, 'defect')).toBe(0);
    embed.mockRestore();

    // The next run (the amendment's own job) stores the text the record has now, and only that.
    expect(await reindex(s, 'defect', tile.id)).toEqual({ indexed: 1, unchanged: 0 });
    const rows = await chunkRows(s, 'defect');
    expect(rows).toHaveLength(1);
    const a = (await ask(s.pm.browser, s, 'Why was the substrate out of level?')).json();
    expect(a.found).toBe(true);
    expect(a.citations[0]).toMatchObject({ sourceId: tile.id, revision: 'disputed' });
  });

  it('gives the worker an actor that holds no permission and retrieves from no scope', async () => {
    const s = await setup('re-actor');
    const registry = buildRegistry(FOUNDATION_PERMISSIONS, ...MODULE_PERMISSIONS);
    const keys = [...registry.keys()];
    expect(keys.length).toBeGreaterThan(50);
    const projectId = decodeId('project', s.project.id)!;

    const verdicts = await t.adminDb.withTenantTx(systemCtx(s), async (scope) => {
      const out: string[] = [];
      for (const key of keys) {
        for (const resource of [{ projectId }, {}]) {
          if (await t.modules.access.api.can(scope, key, resource)) out.push(key);
        }
      }
      return out;
    });
    expect(verdicts).toEqual([]);

    // The same check does allow an org owner every key, so a denial above is the actor's, not a mistyped key.
    const owner = await t.adminDb.withTenantTx(systemCtx(s, ['ai'], 'owner'), async (scope) => {
      const out: string[] = [];
      for (const key of keys)
        if (!(await t.modules.access.api.can(scope, key, { projectId }))) out.push(key);
      return out;
    });
    expect(owner).toEqual([]);

    const scopes = await t.adminDb.withTenantTx(systemCtx(s), async (scope) => ({
      documents: await t.modules.documents.api.aiAccessScopes(scope, projectId),
      rfis: await t.modules.rfis.api.aiAccessScopes(scope, projectId),
      defects: await t.modules.defects.api.aiAccessScopes(scope, projectId),
      diary: await t.modules.diary.api.aiAccessScopes(scope, projectId),
    }));
    expect(scopes).toEqual({ documents: [], rfis: [], defects: [], diary: [] });
  });

  it('records a background run under the actor, and writes no text into the request row', async () => {
    const s = await setup('re-audit');
    const door = await issuedDefect(s, 'Plant room door', 'The door swings the wrong way.');
    expect(await reindex(s, 'defect', door.id)).toEqual({ indexed: 1, unchanged: 0 });

    const rows = await t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
      const res = await tx.execute<Record<string, unknown>>(
        sql`select * from ai.ai_requests where org_id = ${decodeId('org', s.org.id)!}`,
      );
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user_id).toBe(AI_INDEX_ACTOR);
      expect(JSON.stringify(row)).not.toContain('swings the wrong way');
    }
  });
});
