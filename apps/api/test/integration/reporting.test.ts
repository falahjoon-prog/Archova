import { PDFDocument } from 'pdf-lib';
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

// Portfolio dashboard and report builder, through the real rfis, defects and submittals modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Tool = { restricted: boolean; open: number; overdue: number };
type Portfolio = {
  totals: Record<string, number | string>;
  projects: Array<{
    id: string;
    name: string;
    attention: number;
    rfis: Tool;
    defects: Tool;
    submittals: Tool;
    budget: Record<string, unknown>;
  }>;
  truncated: boolean;
};
type Result = {
  columns: string[];
  rows: Array<{ project: string; ref: string; title: string; overdue: boolean }>;
  restrictedProjects: number;
  truncated: boolean;
};
type Report = { id: string; name: string; shared: boolean; mine: boolean };

async function setup() {
  const pm = await signUp(t.app, 'rep-pm');
  const sub = await signUp(t.app, 'rep-sub');
  const org = await createOrg(pm.browser, 'Report Builder Co');
  const a = await createProject(pm.browser, org.id, { name: 'Alpha Tower', state: 'QLD' });
  const b = await createProject(pm.browser, org.id, { name: 'Bravo Lofts', state: 'QLD' });
  await addMember(pm.browser, org.id, a.id, sub.email, 'Subcontractor', 'Sparky');
  const baseA = `/v1/orgs/${org.id}/projects/${a.id}`;
  const baseB = `/v1/orgs/${org.id}/projects/${b.id}`;

  // Project A: one open RFI, past its due date, and one that is not yet due.
  for (const [subject, dueDate] of [
    ['Slab edge detail', '2020-01-10'],
    ['Balustrade height', '2099-01-10'],
  ] as const) {
    const draft = await pm.browser.post(`${baseA}/rfis`, {
      subject,
      question: 'Which detail governs?',
      assigneeIds: [pm.userId],
      dueDate,
    });
    expect(draft.statusCode).toBe(201);
    const opened = await pm.browser.post(`${baseA}/rfis/${draft.json().rfi.id}/open`, undefined, {
      'if-match': draft.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
  }

  // Project B: one issued defect, past its due date, pinned on a published sheet.
  const subCo = await addMember(pm.browser, org.id, b.id, sub.email, 'Subcontractor', 'Sparky B');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const set = (await pm.browser.post(`${baseB}/drawing-sets`, { name: 'IFC' })).json();
  const fileId = await uploadBytes(t, pm.browser, org.id, b.id, await doc.save());
  const rev = await pm.browser.post(`${baseB}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-101',
    title: 'Level 3',
    rev: 'A',
    fileId,
  });
  await pm.browser.post(`${baseB}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
  const defect = await pm.browser.post(`${baseB}/defects`, {
    title: 'Chipped tile in bathroom 302',
    priority: 'high',
    trade: 'tiling',
    assigneeCompanyId: subCo.companyId,
    dueDate: '2020-02-01',
    pin: { drawingRevisionId: rev.json().id, x: 0.4, y: 0.6 },
  });
  expect(defect.statusCode).toBe(201);
  expect(
    (
      await pm.browser.post(
        `${baseB}/defects/${defect.json().defect.id}/transition`,
        { action: 'issue' },
        { 'if-match': defect.headers.etag as string },
      )
    ).statusCode,
  ).toBe(200);
  return { pm, sub, org, a, b, root: `/v1/orgs/${org.id}` };
}

describe('Portfolio dashboard', () => {
  it('counts open and overdue per project and totals them, most overdue first', async () => {
    const s = await setup();
    const res = await s.pm.browser.get(`${s.root}/portfolio`);
    expect(res.statusCode).toBe(200);
    const p = res.json() as Portfolio;
    expect(p.totals).toMatchObject({
      projects: 2,
      rfisOpen: 2,
      rfisOverdue: 1,
      defectsOpen: 1,
      defectsOverdue: 1,
    });
    expect(p.projects.map((x) => x.name)).toEqual(['Alpha Tower', 'Bravo Lofts']);
    expect(p.projects[0]).toMatchObject({ attention: 1, rfis: { open: 2, overdue: 1 } });
    expect(p.projects[1]).toMatchObject({ attention: 1, defects: { open: 1, overdue: 1 } });
    // Neither project has a budget yet: no figures, and they don't count towards the company's budget position.
    expect(p.projects[0]!.budget).toMatchObject({
      hasBudget: false,
      revised: '0.00',
      variance: '0.00',
    });
    expect(p.totals).toMatchObject({
      budgetProjects: 0,
      projectsOverBudget: 0,
      budgetVariance: '0.00',
    });
  });

  it('is staff only: a subcontractor on one project cannot open it', async () => {
    const s = await setup();
    expect((await s.sub.browser.get(`${s.root}/portfolio`)).statusCode).toBe(403);
    expect((await s.sub.browser.get(`${s.root}/reports`)).statusCode).toBe(403);
  });

  it("never shows another company's projects", async () => {
    const s = await setup();
    const other = await signUp(t.app, 'rep-other');
    const org2 = await createOrg(other.browser, 'Other Builders');
    await createProject(other.browser, org2.id, { name: 'Zulu Plaza', state: 'VIC' });
    const p = (await other.browser.get(`/v1/orgs/${org2.id}/portfolio`)).json() as Portfolio;
    expect(p.projects.map((x) => x.name)).toEqual(['Zulu Plaza']);
    expect(p.totals).toMatchObject({ rfisOpen: 0, defectsOpen: 0 });
    // And no way in to the first company's.
    expect([403, 404]).toContain((await other.browser.get(`${s.root}/portfolio`)).statusCode);
  });
});

describe('Report builder', () => {
  const config = (over: Record<string, unknown> = {}) => ({
    source: 'rfis',
    state: 'open',
    projectIds: [],
    columns: ['ref', 'project', 'title', 'overdue'],
    overdueOnly: false,
    ...over,
  });

  it('previews, saves, lists, runs, updates and deletes a report', async () => {
    const s = await setup();
    const preview = await s.pm.browser.post(`${s.root}/reports/preview`, config());
    expect(preview.statusCode).toBe(200);
    const r = preview.json() as Result;
    // Columns come back in display order whatever order they were chosen in.
    expect(r.columns).toEqual(['project', 'ref', 'title', 'overdue']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ project: 'Alpha Tower' });

    const created = await s.pm.browser.post(`${s.root}/reports`, {
      name: 'Overdue RFIs',
      shared: false,
      config: config({ overdueOnly: true }),
    });
    expect(created.statusCode).toBe(201);
    const report = created.json() as Report;
    expect(report).toMatchObject({ name: 'Overdue RFIs', shared: false, mine: true });

    const run = (await s.pm.browser.get(`${s.root}/reports/${report.id}/run`)).json() as Result;
    expect(run.rows.map((x) => x.title)).toEqual(['Slab edge detail']);

    // Narrowed to the project without RFIs, nothing comes back.
    const onlyB = await s.pm.browser.put(`${s.root}/reports/${report.id}`, {
      name: 'Bravo defects',
      shared: true,
      config: config({ source: 'defects', projectIds: [s.b.id], overdueOnly: false }),
    });
    expect(onlyB.statusCode).toBe(200);
    const run2 = (await s.pm.browser.get(`${s.root}/reports/${report.id}/run`)).json() as Result;
    expect(run2.rows.map((x) => x.title)).toEqual(['Chipped tile in bathroom 302']);

    expect(((await s.pm.browser.get(`${s.root}/reports`)).json().data as Report[]).length).toBe(1);
    expect((await s.pm.browser.del(`${s.root}/reports/${report.id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.root}/reports/${report.id}`)).statusCode).toBe(404);
  });

  it('refuses a bad project id', async () => {
    const s = await setup();
    const res = await s.pm.browser.post(`${s.root}/reports/preview`, config({ projectIds: ['x'] }));
    expect(res.statusCode).toBe(422);
  });

  it("keeps a private report to its maker and another company's reports out of reach", async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.root}/reports`, {
      name: 'Mine only',
      shared: false,
      config: config(),
    });
    const id = (created.json() as Report).id;
    const other = await signUp(t.app, 'rep-other2');
    const org2 = await createOrg(other.browser, 'Another Builders');
    expect([403, 404]).toContain(
      (await other.browser.get(`/v1/orgs/${org2.id}/reports/${id}`)).statusCode,
    );
    expect((await other.browser.get(`/v1/orgs/${org2.id}/reports`)).json().data).toEqual([]);
  });
});
