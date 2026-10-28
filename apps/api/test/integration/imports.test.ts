import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const csv = (s: string) => new TextEncoder().encode(s);

async function setup(prefix: string) {
  const pm = await signUp(t.app, `${prefix}-pm`);
  const sub = await signUp(t.app, `${prefix}-sub`);
  const org = await createOrg(pm.browser, 'Import Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower I', state: 'VIC' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparks I');
  const file = (text: string) =>
    uploadBytes(t, pm.browser, org.id, project.id, csv(text), 'rfi-log.csv', 'text/csv');
  return { pm, sub, org, project, base, file };
}

const LOG = [
  'RFI No,Subject,Status,Date Raised,Raised By',
  'RFI-001,"Slab edge, level 2",Closed - Answered,4/3/2026,Jo',
  'RFI-002,Door hardware,Open,5/3/2026,Sam',
  'RFI-002,Duplicate number,Open,5/3/2026,Sam',
  'RFI-004,Fire collar,Mystery,31/2/2026,Sam',
  '',
  'RFI-005,,Open,6/3/2026,Jo',
].join('\r\n');

describe('import staging (integrations/07)', () => {
  it('stages a register, maps its columns and dry-runs every row', async () => {
    const s = await setup('imp');
    const url = `${s.base}/import-jobs`;
    const created = await s.pm.browser.post(url, { entity: 'rfi', fileId: await s.file(LOG) });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'uploaded', entity: 'rfi', totalRows: 0 });
    const id = created.json().id as string;

    // Only one import at a time on a project.
    const second = await s.pm.browser.post(url, { entity: 'rfi', fileId: await s.file(LOG) });
    expect(second.json().code).toBe('import.already_open');

    const parsed = await s.pm.browser.post(
      `${url}/${id}/parse`,
      {},
      { 'if-match': etagOf(created) },
    );
    expect(parsed.statusCode).toBe(200);
    expect(parsed.json()).toMatchObject({
      status: 'parsed',
      totalRows: 5,
      headers: ['RFI No', 'Subject', 'Status', 'Date Raised', 'Raised By'],
    });

    // A required field with no column is refused, naming the field.
    const incomplete = await s.pm.browser.put(
      `${url}/${id}/mapping`,
      { columns: { number: 0, subject: 1 } },
      { 'if-match': etagOf(parsed) },
    );
    expect(incomplete.json().code).toBe('import.mapping_incomplete');
    const clash = await s.pm.browser.put(
      `${url}/${id}/mapping`,
      { columns: { number: 0, subject: 0 } },
      { 'if-match': etagOf(parsed) },
    );
    expect(clash.json().code).toBe('import.invalid_mapping');

    const mapped = await s.pm.browser.put(
      `${url}/${id}/mapping`,
      {
        columns: { number: 0, subject: 1, status: 2, openedAt: 3, authorName: 4 },
        values: { status: { 'Closed - Answered': 'closed' } },
      },
      { 'if-match': etagOf(parsed) },
    );
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json()).toMatchObject({
      status: 'validated',
      totalRows: 5,
      validRows: 2,
      invalidRows: 3,
    });

    const rows = (await s.pm.browser.get(`${url}/${id}/rows`)).json().data as Array<{
      rowNumber: number;
      status: string;
      sourceRef: string | null;
      errors: Array<{ field: string }>;
      normalised: Record<string, unknown> | null;
    }>;
    expect(rows.map((r) => [r.rowNumber, r.status])).toEqual([
      [2, 'valid'],
      [3, 'valid'],
      [4, 'invalid'],
      [5, 'invalid'],
      [7, 'invalid'],
    ]);
    expect(rows[0]).toMatchObject({
      sourceRef: '1',
      normalised: {
        number: 1,
        subject: 'Slab edge, level 2',
        status: 'closed',
        openedAt: '2026-03-04',
      },
    });
    expect(rows[2]!.errors.map((e) => e.field)).toEqual(['number']);
    expect(rows[3]!.errors.map((e) => e.field).sort()).toEqual(['openedAt', 'status']);
    expect(rows[4]!.errors.map((e) => e.field)).toEqual(['subject']);
    const bad = (await s.pm.browser.get(`${url}/${id}/rows?status=invalid`)).json();
    expect(bad.data).toHaveLength(3);

    // Cancelling frees the project for the next import; a stale ETag is refused first.
    const job = await s.pm.browser.get(`${url}/${id}`);
    expect(
      (await s.pm.browser.post(`${url}/${id}/cancel`, {}, { 'if-match': etagOf(parsed) }))
        .statusCode,
    ).toBe(412);
    const cancelled = await s.pm.browser.post(
      `${url}/${id}/cancel`,
      {},
      { 'if-match': etagOf(job) },
    );
    expect(cancelled.json().status).toBe('cancelled');
    expect(
      (await s.pm.browser.post(url, { entity: 'rfi', fileId: await s.file(LOG) })).statusCode,
    ).toBe(201);
    expect((await s.pm.browser.get(url)).json().data).toHaveLength(2);
  });

  it('keeps imports to project admins and refuses unusable files', async () => {
    const s = await setup('imp2');
    const url = `${s.base}/import-jobs`;
    expect((await s.sub.browser.get(url)).statusCode).toBe(403);
    expect(
      (await s.sub.browser.post(url, { entity: 'rfi', fileId: await s.file(LOG) })).statusCode,
    ).toBe(403);

    const empty = await s.pm.browser.post(url, { entity: 'rfi', fileId: await s.file('\n\n') });
    const parsed = await s.pm.browser.post(
      `${url}/${empty.json().id}/parse`,
      {},
      { 'if-match': etagOf(empty) },
    );
    expect(parsed.json().code).toBe('import.no_header');
    expect((await s.pm.browser.get(`${url}/imp_00000000000000000000000000`)).json().code).toBe(
      'import.not_found',
    );
  });

  it('survives hostile files: NUL bytes are dropped, absurd shapes and non-CSV files are refused', async () => {
    const s = await setup('imp3');
    const url = `${s.base}/import-jobs`;
    const nul = await s.pm.browser.post(url, {
      entity: 'rfi',
      fileId: await s.file('No,Subject\u0000\n1,Door\u0000 hardware\n'),
    });
    const parsed = await s.pm.browser.post(
      `${url}/${nul.json().id}/parse`,
      {},
      { 'if-match': etagOf(nul) },
    );
    expect(parsed.statusCode).toBe(200);
    expect(parsed.json()).toMatchObject({ headers: ['No', 'Subject'], totalRows: 1 });
    await s.pm.browser.post(`${url}/${nul.json().id}/cancel`, {}, { 'if-match': etagOf(parsed) });

    const wide = await s.pm.browser.post(url, {
      entity: 'rfi',
      fileId: await s.file(','.repeat(500)),
    });
    const tooWide = await s.pm.browser.post(
      `${url}/${wide.json().id}/parse`,
      {},
      { 'if-match': etagOf(wide) },
    );
    expect(tooWide.json().code).toBe('import.file_not_a_register');
    await s.pm.browser.post(`${url}/${wide.json().id}/cancel`, {}, { 'if-match': etagOf(wide) });

    // A PDF is not a register.
    const pdf = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, csv('%PDF-1.4'));
    const refused = await s.pm.browser.post(url, { entity: 'rfi', fileId: pdf });
    expect(refused.json().code).toBe('import.file_not_a_register');
  });
});
