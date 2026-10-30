import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeId } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { endOfLocalDay, localDateOf } from '@archova/time';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';
import { scannedPdf } from './scans';

// ai/05 §4: an org's OCR is held to a daily page cap, the dearest background work Nova does. With a cap of one page,
// the first page of the day is read and the next call is refused until the org's local day turns over.
let t: TestContext;
/** The app's logger, silent but watched: the cap logs one line a day. */
const logger = createLogger('test', 'silent');
const warn = vi.spyOn(logger, 'warn');
beforeAll(async () => {
  t = await createTestContext({ env: { API_AI_OCR_DAILY_PAGES: '1' }, logger });
});
afterAll(() => t.close());

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, `${label} Builders`);
  const project = await createProject(owner.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const folder = (await owner.browser.post(`${base}/folders`, { name: 'Specs' })).json();
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', owner.userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL_ENTITLEMENTS,
    requestId: 'test',
  };
  return { owner, org, project, base, folder, ctx };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A document of `pages` scanned pages; a different `width` makes a different file, which is read on its own. */
async function addScan(s: Setup, title: string, docNumber: string, pages = 1, width = 1240) {
  const bytes = await scannedPdf(
    Array.from({ length: pages }, () => ({
      scan: { width, height: 1754 },
      size: [595, 842] as [number, number],
    })),
  );
  const fileId = await uploadBytes(t, s.owner.browser, s.org.id, s.project.id, bytes);
  const res = await s.owner.browser.post(`${s.base}/documents`, {
    folderId: s.folder.id,
    title,
    docNumber,
    revision: { rev: 'A', fileId },
  });
  expect(res.statusCode, res.body).toBe(201);
}

const index = (s: Setup) => s.owner.browser.post(`${s.base}/ai/index`);

describe('the daily cap on OCR pages', () => {
  it('stops an org at its cap with a reset time, logs it once, and carries on the next local day', async () => {
    const s = await setup('ocr-day');
    await addScan(s, 'Hydraulic Specification', 'SPEC-0712');
    await addScan(s, 'Fire Specification', 'SPEC-0713', 1, 1241);
    await addScan(s, 'Electrical Specification', 'SPEC-0714', 1, 1242);
    const before = t.ai.ocrCalls.length;

    // The index reads two files at a time, and the cap is read before each call, so the first one or two documents
    // are read (whether the second saw the first depends on timing) and the rest are refused.
    const refused = await index(s);
    expect(refused.statusCode).toBe(429);
    const today = localDateOf(new Date(), 'Australia/Sydney');
    expect(refused.json()).toMatchObject({
      code: 'ai.ocr_limit',
      resetsAt: endOfLocalDay(today, 'Australia/Sydney').toISOString(),
    });
    const read = t.ai.ocrCalls.length - before;
    expect(read).toBeGreaterThanOrEqual(1);
    expect(read).toBeLessThanOrEqual(2);

    // Running it again the same day reads nothing more, and the org is logged once.
    expect((await index(s)).statusCode).toBe(429);
    expect(t.ai.ocrCalls.length - before).toBe(read);
    const lines = warn.mock.calls
      .filter(
        ([fields, msg]) =>
          msg === 'ai daily ocr cap reached' && (fields as { orgId: string }).orgId === s.ctx.orgId,
      )
      .map(([fields]) => fields);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ task: 'ocr.page', capPages: 1 });

    // Yesterday's pages do not count towards today: move the day's usage back a day, and the rest is read, each
    // document once.
    await t.adminDb.withTenantTx(s.ctx, ({ tx }) =>
      tx.execute(
        sql`update ai.ai_requests set created_at = created_at - interval '1 day'
            where org_id = ${s.ctx.orgId} and task = 'ocr.page'`,
      ),
    );
    const resumed = await index(s);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(t.ai.ocrCalls.length - before).toBe(3);
  });

  it('reads a document longer than the cap when it is the first call of the day, then stops', async () => {
    const s = await setup('ocr-long');
    await addScan(s, 'Hydraulic Specification', 'SPEC-0712', 3);
    const before = t.ai.ocrCalls.length;
    const first = await index(s);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ ocrPages: 3 });

    await addScan(s, 'Fire Specification', 'SPEC-0713', 1, 1241);
    expect((await index(s)).statusCode).toBe(429);
    expect(t.ai.ocrCalls.length - before).toBe(3);
  });

  it("counts each org's own pages", async () => {
    const a = await setup('ocr-own-a');
    const b = await setup('ocr-own-b');
    await addScan(a, 'Hydraulic Specification', 'SPEC-0712');
    await addScan(b, 'Hydraulic Specification', 'SPEC-0712');
    expect((await index(a)).statusCode).toBe(200);
    // B has read none of its own, however many A has.
    expect((await index(b)).statusCode).toBe(200);
  });
});
