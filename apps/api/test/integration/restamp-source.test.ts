import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeId } from '@archova/domain';
import { AI_INDEX_ACTOR } from '@archova/mod-ai';
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

async function pdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 800 - i * 14, size: 10, font }));
  return doc.save();
}

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor');
  const openRes = await pm.browser.post(`${base}/folders`, { name: 'Site' });
  const legal = (
    await pm.browser.post(`${base}/folders`, { name: 'Contracts', isPrivate: true })
  ).json();
  return {
    pm,
    sub,
    org,
    project,
    base,
    open: openRes.json().id as string,
    openEtag: openRes.headers.etag as string,
    legal: legal.id as string,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** The ai-worker's context for the restamp: the org, the named system actor, and no plan at all. */
const systemCtx = (s: Setup) => ({
  orgId: decodeId('org', s.org.id)!,
  userId: AI_INDEX_ACTOR,
  principalType: 'member' as const,
  orgRole: null,
  entitlements: { plan: 'system', state: 'active' as const, modules: [] as string[], limits: {} },
  requestId: 'test',
});

async function addDocument(
  s: Setup,
  folderId: string,
  title: string,
  number: string,
  text: string,
) {
  const fileId = await uploadBytes(
    t,
    s.pm.browser,
    s.org.id,
    s.project.id,
    await pdf([title, text]),
  );
  const res = await s.pm.browser.post(`${s.base}/documents`, {
    folderId,
    title,
    docNumber: number,
    revision: { rev: 'A', fileId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().document.id as string, etag: res.headers.etag as string };
}

const index = async (s: Setup) => {
  const res = await s.pm.browser.post(`${s.base}/ai/index`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const found = async (b: Browser, s: Setup, query: string) => {
  const res = await b.post(`${s.base}/ai/search`, { query });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().results as Array<{ sourceId: string }>).map((r) => r.sourceId);
};
/** What the ai-worker does on a document or drawing event: `kind` is the API id's kind. */
const restamp = (
  s: Setup,
  kind: 'document' | 'drawingSheet',
  apiId: string,
  project: string = s.project.id,
) =>
  t.modules.ai.api.restampSource(
    systemCtx(s),
    decodeId('project', project)!,
    decodeId(kind, apiId)!,
  );

const embedSpy = () => vi.spyOn(t.ai, 'embed');
const requestCount = (s: Setup) =>
  t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
    const res = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ai.ai_requests where org_id = ${decodeId('org', s.org.id)!}`,
    );
    return res.rows[0]!.n;
  });

/** Runs `change` while the next embedding call is in flight, as a person could. */
const duringEmbed = (change: () => Promise<void>) => {
  const real = t.ai.embed.bind(t.ai);
  return vi.spyOn(t.ai, 'embed').mockImplementationOnce(async (...args) => {
    await change();
    return real(...args);
  });
};

const move = async (s: Setup, doc: { id: string; etag: string }, folderId: string) => {
  const res = await s.pm.browser.patch(
    `${s.base}/documents/${doc.id}`,
    { folderId },
    { 'if-match': doc.etag },
  );
  expect(res.statusCode, res.body).toBe(200);
  return { id: doc.id, etag: res.headers.etag as string };
};

const chunkRows = (s: Setup, sourceId?: string) =>
  t.adminDb.withTenantTx(systemCtx(s), async ({ tx }) => {
    const res = await tx.execute<{
      source_id: string;
      revision_label: string;
      status: string;
      access_scope: string;
    }>(
      sql`select source_id, revision_label, status, access_scope from ai.ai_chunks
          where project_id = ${decodeId('project', s.project.id)!}
          ${sourceId ? sql`and source_id = ${sourceId}` : sql``}
          order by revision_label, chunk_index`,
    );
    return res.rows;
  });

const QUERY = 'liquidated damages per day of delay';
const CLAUSE = 'Liquidated damages are CANARY-LD-4417 dollars per day of delay.';

describe('Re-stamping a document or sheet after it changes', () => {
  it('stops a document moved into a private folder being found by people outside it, with no model call', async () => {
    const s = await setup('rs-move');
    const doc = await addDocument(s, s.open, 'Head Contract', 'HC-01', CLAUSE);
    await index(s);
    expect(await found(s.sub.browser, s, QUERY)).toContain(doc.id);
    expect(await chunkRows(s, decodeId('document', doc.id)!)).toMatchObject([
      { access_scope: `folder:${decodeId('folder', s.open)!}`, status: 'current' },
    ]);

    await move(s, doc, s.legal);
    // Until the event is processed the old label stands: this is the gap the subscriber closes.
    expect(await found(s.sub.browser, s, QUERY)).toContain(doc.id);

    // Searching embeds the question, so count the model calls around the re-stamp alone.
    const embed = embedSpy();
    const calls = embed.mock.calls.length;
    const requests = await requestCount(s);
    await restamp(s, 'document', doc.id);
    expect(embed.mock.calls.length).toBe(calls);
    expect(await requestCount(s)).toBe(requests);
    expect(await found(s.sub.browser, s, QUERY)).not.toContain(doc.id);
    expect(await found(s.pm.browser, s, QUERY)).toContain(doc.id);
    expect(await chunkRows(s, decodeId('document', doc.id)!)).toMatchObject([
      { access_scope: `folder:${decodeId('folder', s.legal)!}` },
    ]);
    // The text did not change, so nothing was embedded or billed, and the full index agrees.
    embed.mockRestore();
    expect(await index(s)).toMatchObject({ indexed: 0, unchanged: 1 });
  });

  it('follows a folder being made private with no re-stamp at all, since access is read when you search', async () => {
    const s = await setup('rs-folder');
    const doc = await addDocument(s, s.open, 'Head Contract', 'HC-01', CLAUSE);
    await index(s);
    expect(await found(s.sub.browser, s, QUERY)).toContain(doc.id);

    const made = await s.pm.browser.patch(
      `${s.base}/folders/${s.open}`,
      { isPrivate: true },
      { 'if-match': s.openEtag },
    );
    expect(made.statusCode, made.body).toBe(200);
    expect(await found(s.sub.browser, s, QUERY)).not.toContain(doc.id);
    expect(await found(s.pm.browser, s, QUERY)).toContain(doc.id);
  });

  it('marks the old revision of a document superseded when a new one is added, without embedding the new one', async () => {
    const s = await setup('rs-rev');
    const doc = await addDocument(s, s.open, 'Head Contract', 'HC-01', CLAUSE);
    await index(s);
    const fileB = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      await pdf(['Head Contract', 'Liquidated damages are now CANARY-LD-5520 dollars per day.']),
    );
    const added = await s.pm.browser.post(`${s.base}/documents/${doc.id}/revisions`, {
      rev: 'B',
      fileId: fileB,
    });
    expect(added.statusCode, added.body).toBe(201);

    const embed = embedSpy();
    await restamp(s, 'document', doc.id);
    expect(embed).not.toHaveBeenCalled();
    embed.mockRestore();
    expect(await chunkRows(s, decodeId('document', doc.id)!)).toMatchObject([
      { revision_label: 'A', status: 'superseded' },
    ]);
    // The next full index embeds revision B and leaves A as the superseded one.
    expect(await index(s)).toMatchObject({ indexed: 1, unchanged: 1 });
    expect(await chunkRows(s, decodeId('document', doc.id)!)).toMatchObject([
      { revision_label: 'A', status: 'superseded' },
      { revision_label: 'B', status: 'current' },
    ]);
  });

  it("supersedes a sheet's old revision when a new one is published", async () => {
    const s = await setup('rs-sheet');
    const publish = async (rev: string, text: string) => {
      const set = (
        await s.pm.browser.post(`${s.base}/drawing-sets`, { name: `IFC ${rev}` })
      ).json();
      const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await pdf([text]));
      const r = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
        sheetNumber: 'S-001',
        title: 'Structural Notes',
        rev,
        fileId,
      });
      expect(r.statusCode, r.body).toBe(201);
      const pub = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
        confirmNewSheets: true,
      });
      expect(pub.statusCode, pub.body).toBe(200);
    };
    await publish(
      'A',
      'S-001 STRUCTURAL NOTES. Provide a drainage cell CANARY-DR-1 behind the walls.',
    );
    await index(s);
    const sheet = (await s.pm.browser.get(`${s.base}/drawings`)).json().data[0].id as string;
    expect(await chunkRows(s, decodeId('drawingSheet', sheet)!)).toMatchObject([
      { revision_label: 'A', status: 'current', access_scope: 'drawings' },
    ]);

    await publish(
      'B',
      'S-001 STRUCTURAL NOTES. Provide a drainage cell CANARY-DR-2 behind the walls.',
    );
    const embed = embedSpy();
    await restamp(s, 'drawingSheet', sheet);
    expect(embed).not.toHaveBeenCalled();
    embed.mockRestore();
    expect(await chunkRows(s, decodeId('drawingSheet', sheet)!)).toMatchObject([
      { revision_label: 'A', status: 'superseded', access_scope: 'drawings' },
    ]);
  });

  it('only touches the project and org the source is in', async () => {
    const a = await setup('rs-scope-a');
    const b = await setup('rs-scope-b');
    const doc = await addDocument(a, a.open, 'Head Contract', 'HC-01', CLAUSE);
    await index(a);
    const before = await chunkRows(a);
    // Another org, or another project, naming the same document finds nothing to do and drops nothing.
    await restamp(b, 'document', doc.id);
    await restamp(a, 'document', doc.id, b.project.id);
    expect(await chunkRows(a)).toEqual(before);
  });

  it('indexes a document moved while its text was being embedded under the folder it is in now', async () => {
    const s = await setup('rs-race-move');
    const doc = await addDocument(s, s.open, 'Head Contract', 'HC-01', CLAUSE);
    const embed = duringEmbed(async () => {
      await move(s, doc, s.legal);
    });
    expect(await index(s)).toMatchObject({ indexed: 1 });
    expect(embed).toHaveBeenCalledTimes(1);
    embed.mockRestore();
    // Stamped from the register as it is at insert, not as it was before the embedding began.
    expect(await chunkRows(s, decodeId('document', doc.id)!)).toMatchObject([
      { access_scope: `folder:${decodeId('folder', s.legal)!}` },
    ]);
    expect(await found(s.sub.browser, s, QUERY)).not.toContain(doc.id);
    expect(await found(s.pm.browser, s, QUERY)).toContain(doc.id);
  });

  it('stores a revision superseded while its text was being embedded as superseded', async () => {
    const s = await setup('rs-race-rev');
    const doc = await addDocument(s, s.open, 'Head Contract', 'HC-01', CLAUSE);
    const embed = duringEmbed(async () => {
      const fileB = await uploadBytes(
        t,
        s.pm.browser,
        s.org.id,
        s.project.id,
        await pdf(['Head Contract', 'Replaced.']),
      );
      const added = await s.pm.browser.post(`${s.base}/documents/${doc.id}/revisions`, {
        rev: 'B',
        fileId: fileB,
      });
      expect(added.statusCode, added.body).toBe(201);
    });
    await index(s);
    embed.mockRestore();
    const rows = await chunkRows(s, decodeId('document', doc.id)!);
    expect(rows.filter((r) => r.revision_label === 'A')).toMatchObject([{ status: 'superseded' }]);
  });
});
