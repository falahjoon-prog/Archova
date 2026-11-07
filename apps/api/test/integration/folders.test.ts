import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTestContext,
  outboxData,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

// A Google Drive that remembers what was created, so the real Drive provider runs against it.
interface Node {
  id: string;
  name: string;
  parent: string | null;
  folder: boolean;
}
let nodes = new Map<string, Node>();
let seq = 0;
let pending = new Map<string, { id: string | null; name?: string; parent?: string }>();
let refuse = false;
const fakeFetch = async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token'))
    return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
  if (refuse && url.includes('/upload/')) return json({ error: 'forbidden' }, 401);
  if (url.startsWith('https://upload.fake/')) {
    const p = pending.get(url)!;
    if (p.id) return json({ id: p.id });
    const n: Node = { id: `g-${++seq}`, name: p.name!, parent: p.parent!, folder: false };
    nodes.set(n.id, n);
    return json({ id: n.id });
  }
  if (url.includes('/upload/drive/v3/files')) {
    const target = `https://upload.fake/${++seq}`;
    const existing = decodeURIComponent(url.match(/files\/([^?]+)\?/)?.[1] ?? '');
    const meta = JSON.parse(String(init?.body ?? '{}')) as { name?: string; parents?: string[] };
    pending.set(
      target,
      existing
        ? { id: existing }
        : { id: null, ...(meta.name ? { name: meta.name } : {}), parent: meta.parents![0]! },
    );
    return new Response(null, { status: 200, headers: { location: target } });
  }
  if (method === 'GET' && url.includes('/drive/v3/files?')) {
    const q = new URL(url).searchParams.get('q')!;
    const parent = /'([^']+)' in parents/.exec(q)![1]!;
    const name = /name = '([^']+)'/.exec(q)![1]!;
    const folder = q.includes("mimeType = 'application/vnd.google-apps.folder'");
    return json({
      files: [...nodes.values()]
        .filter((n) => n.parent === parent && n.name === name && n.folder === folder)
        .map((n) => ({ id: n.id })),
    });
  }
  if (method === 'POST' && url.includes('/drive/v3/files')) {
    const b = JSON.parse(String(init?.body)) as { name: string; parents?: string[] };
    const n: Node = {
      id: `g-${++seq}`,
      name: b.name,
      parent: b.parents?.[0] ?? null,
      folder: true,
    };
    nodes.set(n.id, n);
    return json({ id: n.id, name: n.name, webViewLink: `https://drive.example/${n.id}` });
  }
  if (method === 'PATCH' && url.includes('/drive/v3/files/')) {
    const id = decodeURIComponent(url.split('/drive/v3/files/')[1]!.split('?')[0]!);
    const to = new URL(url).searchParams.get('addParents')!;
    nodes.get(id)!.parent = to;
    return json({ id });
  }
  return json({ error: `unhandled ${method} ${url}` }, 500);
};

const jobContext = (orgId: string): TenantContext => ({
  orgId,
  userId: '00000000-0000-0000-0000-000000000000',
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
  requestId: 'test',
});

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({
    accountingFetch: fakeFetch,
    env: { API_GOOGLE_CLIENT_ID: 'gid', API_GOOGLE_CLIENT_SECRET: 'gsecret' },
  });
});
afterAll(() => t.close());

async function setup(label: string) {
  nodes = new Map();
  pending = new Map();
  refuse = false;
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Folder Builders');
  const project = await createProject(owner.browser, org.id, { name: 'Tower F', state: 'NSW' });
  const orgBase = `/v1/orgs/${org.id}`;
  return { owner, org, project, orgBase, base: `${orgBase}/projects/${project.id}` };
}
type S = Awaited<ReturnType<typeof setup>>;

async function connectGoogle(s: S) {
  const start = (
    await s.owner.browser.post(`${s.orgBase}/folder-connections/google/connect`)
  ).json();
  const u = new URL(start.url);
  expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  return s.owner.browser.post(`${s.orgBase}/folder-connections/google/callback`, {
    code: 'c1',
    state: u.searchParams.get('state')!,
  });
}

async function publishDrawing(s: S, set: string, rev: string, bytes = 'pdf-bytes') {
  const fileId = await uploadBytes(
    t,
    s.owner.browser,
    s.org.id,
    s.project.id,
    new TextEncoder().encode(`${bytes} ${rev}`),
    `A-101-${rev}.pdf`,
  );
  const draft = await s.owner.browser.post(`${s.base}/drawing-sets/${set}/revisions`, {
    sheetNumber: 'A-101',
    title: 'Plan',
    rev,
    fileId,
  });
  expect(draft.statusCode).toBe(201);
  const pub = await s.owner.browser.post(`${s.base}/drawing-sets/${set}/publish`, {
    confirmNewSheets: true,
  });
  expect(pub.statusCode).toBe(200);
}

/** Runs the worker's job for the newest published event, the way the dispatcher would. */
async function runPublish(s: S) {
  const events = await outboxData<{
    sheetId: string;
    revisionId: string;
    sheetNumber: string;
    rev: string;
    previousRevisionId: string | null;
    fileId: string;
  }>(t, s.org.id, s.owner.userId, 'documents.drawing.revision.published.v1');
  const d = events.at(-1)!;
  return t.modules.integrations.api.folders.publishRevision(
    t.database,
    jobContext(decodeId('org', s.org.id)!),
    { projectId: decodeId('project', s.project.id)!, ...d },
  );
}

const published = (s: S) =>
  t.database.withTenantTx(
    jobContext(decodeId('org', s.org.id)!),
    async ({ tx }) =>
      (
        await tx.execute(
          sql`select file_name, state from integrations.folder_published order by published_at`,
        )
      ).rows as Array<{ file_name: string; state: string }>,
  );

describe('SharePoint and Drive folder links (integrations/03, 04)', () => {
  it('offers only configured providers and refuses the rest', async () => {
    const s = await setup('fld-avail');
    const list = (await s.owner.browser.get(`${s.orgBase}/folder-connections`)).json();
    expect(list).toEqual({ data: [], available: ['google'] });
    const res = await s.owner.browser.post(`${s.orgBase}/folder-connections/m365/connect`, {
      tenantId: 'contoso.com',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'folders.not_configured' });
  });

  it('refuses a bad state and links only after the connection is active', async () => {
    const s = await setup('fld-state');
    const early = await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' });
    expect(early.statusCode).toBe(404);
    await s.owner.browser.post(`${s.orgBase}/folder-connections/google/connect`);
    const bad = await s.owner.browser.post(`${s.orgBase}/folder-connections/google/callback`, {
      code: 'c',
      state: 'wrong',
    });
    expect(bad.statusCode).toBe(422);
    const ok = await connectGoogle(s);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ provider: 'google', status: 'active' });
    // Tokens are sealed: never in the response.
    expect(ok.body).not.toContain('rt');
  });

  it('publishes a revision, then moves it to Superseded when the next one is issued', async () => {
    const s = await setup('fld-publish');
    await connectGoogle(s);
    const link = await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' });
    expect(link.statusCode).toBe(201);
    expect(link.json()).toMatchObject({ provider: 'google', status: 'active' });
    const again = await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' });
    expect(again.statusCode).toBe(409);

    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'IFC' })).json();
    await publishDrawing(s, set.id, 'A');
    expect(await runPublish(s)).toEqual({ published: 1 });
    // Running the same event again does nothing (at-least-once delivery).
    expect(await runPublish(s)).toEqual({ published: 0 });
    const folderId = [...nodes.values()].find((n) => n.name === 'Archova - Tower F')!.id;
    const superseded = [...nodes.values()].find((n) => n.name === 'Superseded')!;
    expect(superseded.parent).toBe(folderId);
    const filesIn = (parent: string) =>
      [...nodes.values()].filter((n) => !n.folder && n.parent === parent).map((n) => n.name);
    expect(filesIn(folderId)).toEqual(['A-101_Rev-A.pdf']);

    const set2 = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'IFC 2' })).json();
    await publishDrawing(s, set2.id, 'B');
    expect(await runPublish(s)).toEqual({ published: 1 });
    expect(filesIn(folderId)).toEqual(['A-101_Rev-B.pdf']);
    expect(filesIn(superseded.id)).toEqual(['A-101_Rev-A.pdf']);
    expect(await published(s)).toEqual([
      { file_name: 'A-101_Rev-A.pdf', state: 'superseded' },
      { file_name: 'A-101_Rev-B.pdf', state: 'current' },
    ]);

    const links = (await s.owner.browser.get(`${s.base}/folder-links`)).json().data;
    expect(links).toHaveLength(1);
    expect(links[0].lastPublishedAt).not.toBeNull();
    const audit = await outboxData(
      t,
      s.org.id,
      s.owner.userId,
      'integrations.folders.published.v1',
    );
    expect(audit).toHaveLength(2);
  });

  it('lists the revisions already current so a new link can publish them (backfill)', async () => {
    const s = await setup('fld-backfill');
    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'IFC' })).json();
    await publishDrawing(s, set.id, 'A');
    await connectGoogle(s);
    const link = await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' });
    expect(link.statusCode).toBe(201);
    // The worker runs this when it sees integrations.folders.linked.v1.
    const ctx = jobContext(decodeId('org', s.org.id)!);
    const projectId = decodeId('project', s.project.id)!;
    const current = await t.database.withTenantTx(ctx, (scope) =>
      t.modules.documents.api.currentDrawingRevisions(scope, projectId),
    );
    expect(current.map((r) => `${r.sheetNumber}/${r.rev}`)).toEqual(['A-101/A']);
    for (const r of current)
      expect(
        await t.modules.integrations.api.folders.publishRevision(t.database, ctx, {
          projectId,
          ...r,
          previousRevisionId: null,
        }),
      ).toEqual({ published: 1 });
    expect(await published(s)).toEqual([{ file_name: 'A-101_Rev-A.pdf', state: 'current' }]);
    const linked = await outboxData<{ connectionId?: string }>(
      t,
      s.org.id,
      s.owner.userId,
      'integrations.folders.linked.v1',
    );
    expect(linked).toHaveLength(1);
  });

  it('marks the connection for reconnecting when Google refuses, and leaves nothing half recorded', async () => {
    const s = await setup('fld-refused');
    await connectGoogle(s);
    const link = (
      await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' })
    ).json();
    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'IFC' })).json();
    await publishDrawing(s, set.id, 'A');
    refuse = true;
    expect(await runPublish(s)).toEqual({ published: 0 });
    expect(await published(s)).toEqual([]);
    const links = (await s.owner.browser.get(`${s.base}/folder-links`)).json().data;
    expect(links[0]).toMatchObject({ id: link.id, status: 'error' });
    const conns = (await s.owner.browser.get(`${s.orgBase}/folder-connections`)).json().data;
    expect(conns[0]).toMatchObject({ status: 'error' });
  });

  it('unlinks and disconnects without touching what was published', async () => {
    const s = await setup('fld-unlink');
    await connectGoogle(s);
    const link = (
      await s.owner.browser.post(`${s.base}/folder-links`, { provider: 'google' })
    ).json();
    const del = await s.owner.browser.del(`${s.base}/folder-links/${link.id}`);
    expect(del.statusCode).toBe(204);
    expect((await s.owner.browser.get(`${s.base}/folder-links`)).json().data).toEqual([]);
    const gone = await s.owner.browser.del(`${s.orgBase}/folder-connections/google`);
    expect(gone.statusCode).toBe(204);
    expect((await s.owner.browser.get(`${s.orgBase}/folder-connections`)).json().data).toEqual([]);
  });
});
