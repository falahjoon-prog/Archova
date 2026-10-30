import { PDFDocument } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { endOfLocalDay, localDateOf } from '@archova/time';
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

// ai/05 §4: an org's document embeddings are held to a daily token cap, a backstop against a runaway loop or a bulk
// re-index. One token is the smallest cap there is: the first embedding of the day runs, every later one is refused
// until the org's local day turns over.
let t: TestContext;
/** The app's logger, silent but watched: the cap logs one line a day. */
const logger = createLogger('test', 'silent');
const warn = vi.spyOn(logger, 'warn');
beforeAll(async () => {
  t = await createTestContext({ env: { API_AI_EMBED_DAILY_TOKENS: '1' }, logger });
});
afterAll(() => t.close());

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
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', pm.userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL_ENTITLEMENTS,
    requestId: 'test',
  };
  return {
    pm,
    org,
    project,
    subCo,
    base,
    ctx,
    projectId: decodeId('project', project.id)!,
    pin: { drawingRevisionId: rev.json().id as string, x: 0.4, y: 0.6 },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** An issued defect: the quickest record Nova indexes. */
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
  const sent = await s.pm.browser.post(
    `${s.base}/defects/${id}/transition`,
    { action: 'issue' },
    { 'if-match': res.headers.etag as string },
  );
  expect(sent.statusCode, sent.body).toBe(200);
  return id;
}

const index = (b: Browser, s: Setup) => b.post(`${s.base}/ai/index`);

describe('the daily cap on document embeddings', () => {
  it('stops an org at its cap with a reset time, leaves questions alone, and carries on the next local day', async () => {
    const s = await setup('cap-day');
    await issuedDefect(s, 'Bathroom 302 finishes', 'Grout is missing around the shower waste.');
    expect((await index(s.pm.browser, s)).json()).toMatchObject({ defectsIndexed: 1 });

    await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    const refused = await index(s.pm.browser, s);
    expect(refused.statusCode).toBe(429);
    // The org's zone is Sydney: it resets at the start of the next Sydney day.
    const today = localDateOf(new Date(), 'Australia/Sydney');
    expect(refused.json()).toMatchObject({
      code: 'ai.embedding_limit',
      resetsAt: endOfLocalDay(today, 'Australia/Sydney').toISOString(),
    });

    // A person asking a question is not held back, and the first defect is found.
    const ask = await s.pm.browser.post(`${s.base}/ai/ask`, {
      question: 'Where is grout missing around the shower?',
    });
    expect(ask.statusCode, ask.body).toBe(200);
    expect(ask.json().found).toBe(true);

    // Yesterday's embeddings do not count towards today: move the day's usage back a day.
    await t.adminDb.withTenantTx(s.ctx, ({ tx }) =>
      tx.execute(
        sql`update ai.ai_requests set created_at = created_at - interval '1 day'
            where org_id = ${s.ctx.orgId} and task = 'embed.document'`,
      ),
    );
    expect((await index(s.pm.browser, s)).json()).toMatchObject({
      defectsIndexed: 1,
      defectsUnchanged: 1,
    });
  });

  it('logs once a day per org that the cap was reached, however many calls are refused', async () => {
    const s = await setup('cap-log');
    await issuedDefect(s, 'Door closer', 'The door closer on the plant room is loose.');
    expect((await index(s.pm.browser, s)).statusCode).toBe(200);
    await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    for (let i = 0; i < 3; i++) expect((await index(s.pm.browser, s)).statusCode).toBe(429);

    const orgId = decodeId('org', s.org.id)!;
    const lines = warn.mock.calls
      .filter(
        ([fields, msg]) =>
          msg === 'ai daily embedding cap reached' && (fields as { orgId: string }).orgId === orgId,
      )
      .map(([fields]) => fields);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ task: 'embed.document', capTokens: 1 });
    // Ids and numbers only: no record text.
    expect(JSON.stringify(lines[0])).not.toContain('plant room');
  });

  it("counts each org's own usage", async () => {
    const a = await setup('cap-own-a');
    const b = await setup('cap-own-b');
    await issuedDefect(a, 'Door closer', 'The door closer on the plant room is loose.');
    await issuedDefect(b, 'Door closer', 'The door closer on the plant room is loose.');
    expect((await index(a.pm.browser, a)).statusCode).toBe(200);
    // B has used none of its own cap, however much A has used.
    expect((await index(b.pm.browser, b)).statusCode).toBe(200);
    expect((await index(a.pm.browser, a)).json()).toMatchObject({ defectsIndexed: 0 });
  });

  it("does not hold an induction publish behind the org's bulk indexing", async () => {
    const s = await setup('cap-induction');
    await issuedDefect(s, 'Door closer', 'The door closer on the plant room is loose.');
    expect((await index(s.pm.browser, s)).statusCode).toBe(200);
    await issuedDefect(s, 'Level 3 corridor', 'Paint runs along the north wall.');
    expect((await index(s.pm.browser, s)).statusCode).toBe(429);

    const indexed = await t.modules.ai.api.indexInductionVersion(s.ctx, {
      inductionId: uuidv7(),
      versionId: uuidv7(),
      projectId: s.projectId,
      version: 1,
      slides: [
        {
          title: 'Emergencies',
          points: ['On the siren, walk to the assembly point.'],
          script: [],
        },
      ],
    });
    expect(indexed).toEqual({ indexed: true, chunks: 1 });
  });
});
