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

// ai/05 §4: the project index is bulk work and stops at 80% of an org's daily OCR page cap, so what a person asks
// for (a quote, a sheet, the drawing register) still has the rest. With a cap of 10 pages the index's line is 8.
let t: TestContext;
const logger = createLogger('test', 'silent');
const warn = vi.spyOn(logger, 'warn');
beforeAll(async () => {
  t = await createTestContext({ env: { API_AI_OCR_DAILY_PAGES: '10' }, logger });
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

/** A scanned PDF of `pages` pages; a different `width` makes a different file, which is read on its own. */
const scan = (pages: number, width: number) =>
  scannedPdf(
    Array.from({ length: pages }, () => ({
      scan: { width, height: 1754 },
      size: [595, 842] as [number, number],
    })),
  );

/** Puts a scanned document in the project, for the index to read. */
async function addScan(s: Setup, title: string, docNumber: string, pages: number, width: number) {
  const fileId = await uploadBytes(
    t,
    s.owner.browser,
    s.org.id,
    s.project.id,
    await scan(pages, width),
  );
  const res = await s.owner.browser.post(`${s.base}/documents`, {
    folderId: s.folder.id,
    title,
    docNumber,
    revision: { rev: 'A', fileId },
  });
  expect(res.statusCode, res.body).toBe(201);
}

const index = (s: Setup) => s.owner.browser.post(`${s.base}/ai/index`);

/** What a person asks for: the drawing register reads every page of a scanned set in one OCR call. */
async function register(s: Setup, pages: number, width: number) {
  const fileId = await uploadBytes(
    t,
    s.owner.browser,
    s.org.id,
    s.project.id,
    await scan(pages, width),
  );
  return s.owner.browser.post(`${s.base}/ai/drawing-register/extractions`, { fileId });
}

const lines = (s: Setup, msg: string) =>
  warn.mock.calls
    .filter(([fields, m]) => m === msg && (fields as { orgId: string }).orgId === s.ctx.orgId)
    .map(([fields]) => fields);

describe('the share of the OCR cap kept for features a person is waiting on', () => {
  it('stops the index at 80% of the cap, leaves the rest to interactive reads, and logs each line once', async () => {
    const s = await setup('reserve-flow');
    await addScan(s, 'Hydraulic Specification', 'SPEC-0712', 8, 1240);
    const before = t.ai.ocrCalls.length;

    // Eight pages fit the index's line exactly.
    const first = await index(s);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ ocrPages: 8 });
    expect(t.ai.ocrCalls.length - before).toBe(8);

    // One more page for the index is over its line, though the cap itself has two pages left.
    await addScan(s, 'Fire Specification', 'SPEC-0713', 1, 1241);
    const today = localDateOf(new Date(), 'Australia/Sydney');
    const refused = await index(s);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({
      code: 'ai.ocr_limit',
      detail: expect.stringContaining('keeping the rest for scanned pages you ask about'),
      resetsAt: endOfLocalDay(today, 'Australia/Sydney').toISOString(),
    });
    expect((await index(s)).statusCode).toBe(429);
    expect(t.ai.ocrCalls.length - before).toBe(8);

    // The pages kept back are there for a person: two more fill the cap, and the next page is refused outright.
    const reg = await register(s, 2, 1242);
    expect(reg.statusCode, reg.body).toBe(200);
    const over = await register(s, 1, 1243);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({
      code: 'ai.ocr_limit',
      detail: expect.stringContaining('scanned pages as it can for your organisation today'),
    });

    // The bulk share and the cap each log once, as different lines, so an alert on the cap is not set off by the index.
    expect(lines(s, 'ai daily ocr bulk share reached')).toEqual([
      expect.objectContaining({ task: 'ocr.page.bulk', capPages: 10, bulkPages: 8 }),
    ]);
    expect(lines(s, 'ai daily ocr cap reached')).toEqual([
      expect.objectContaining({ task: 'ocr.page', capPages: 10 }),
    ]);
  });

  it('counts what people read towards the index line, so the index cannot take the pages they used', async () => {
    const over = await setup('reserve-shared-over');
    const fits = await setup('reserve-shared-fits');
    // A person's reads come first: five pages, within the cap and below the index's line of eight.
    for (const s of [over, fits]) expect((await register(s, 5, 1250)).statusCode).toBe(200);

    // Four more pages for the index would take the day to nine, over its line: refused, nothing read.
    await addScan(over, 'Hydraulic Specification', 'SPEC-0712', 4, 1251);
    const before = t.ai.ocrCalls.length;
    expect((await index(over)).statusCode).toBe(429);
    expect(t.ai.ocrCalls.length).toBe(before);

    // Three would take it to eight, exactly its line.
    await addScan(fits, 'Hydraulic Specification', 'SPEC-0712', 3, 1252);
    const ok = await index(fits);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ ocrPages: 3 });
    expect(t.ai.ocrCalls.length - before).toBe(3);
  });
});
