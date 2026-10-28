import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'imap-pm');
  const sub = await signUp(t.app, 'imap-sub');
  const mgr = await signUp(t.app, 'imap-admin');
  const site = await signUp(t.app, 'imap-site');
  const org = await createOrg(pm.browser, 'Import Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Brush Co');
  await addMember(pm.browser, org.id, project.id, mgr.email, 'Project Admin', 'Main Co');
  await addMember(pm.browser, org.id, project.id, site.email, 'Site Manager', 'Site Co');
  return { pm, sub, mgr, site, org, project, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}

const col = (header: string, samples: string[], distinct?: string[]) => ({
  header,
  samples,
  ...(distinct ? { distinct } : {}),
});

const RFI_LOG = [
  col('RFI No', ['RFI-14', 'RFI-15']),
  col('Subject', ['Fire rating at riser', 'Paint system in lobby']),
  col('Status', ['Open', 'Closed - Answered'], ['Open', 'Closed - Answered', 'On hold']),
  col('Date Raised', ['04/03/2026', '11/03/2026']),
  col('Raised By', ['Sam Nguyen', 'Priya Shah']),
  col('Ball In Court', ['Fire Eng Co']),
  col('Internal Notes', ['chase Friday']),
];

describe('Nova import mapping (F31)', () => {
  it('suggests where each column goes, what each status means, and what is missing', async () => {
    const s = await setup();
    const res = await s.pm.browser.post(`${s.base}/ai/import-mappings`, {
      entity: 'rfi',
      columns: RFI_LOG,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.suggestionId).toMatch(/^ais_/);
    expect(d.entity).toBe('rfi');
    expect(d.columns.map((c: { field: string | null }) => c.field)).toEqual([
      'number',
      'subject',
      'status',
      'openedAt',
      'authorName',
      'assignee',
      null,
    ]);
    expect(d.columns[0]).toMatchObject({
      index: 0,
      header: 'RFI No',
      confidence: 'high',
      examples: ['RFI-14', 'RFI-15'],
      warning: null,
    });
    // Every value the file uses gets a row; the one Archova has no word for is left for the person.
    expect(d.values).toEqual([
      {
        index: 2,
        field: 'status',
        pairs: [
          { source: 'Open', value: 'open' },
          { source: 'Closed - Answered', value: 'closed' },
          { source: 'On hold', value: null },
        ],
      },
    ]);
    expect(d.missingRequired).toEqual([]);
    // The screen offers these when the person changes a suggestion.
    const status = d.fields.find((f: { key: string }) => f.key === 'status');
    expect(status).toMatchObject({ kind: 'enum', required: true });
    expect(status.values.map((v: { value: string }) => v.value)).toEqual([
      'open',
      'answered',
      'closed',
      'void',
    ]);

    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('import.mapping');
    expect(call.text).toContain('<header>Ball In Court</header>');
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    const row = usage.byFeature.find((f: { feature: string }) => f.feature === 'import_mapping');
    expect(row.runs).toBe(1);
    expect(row.credits).toBeCloseTo(0.25, 5);
  });

  it('withdraws a suggestion whose values do not look like the field, and lists required fields left over', async () => {
    const s = await setup();
    const res = await s.pm.browser.post(`${s.base}/ai/import-mappings`, {
      entity: 'rfi',
      columns: [
        col('Subject', ['Fire rating at riser']),
        // The header says a date, the values are people: not offered as a date.
        col('Date Raised', ['Sam Nguyen', 'Priya Shah']),
      ],
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.columns[1]).toMatchObject({ field: null, warning: 'unlike_values' });
    expect(d.missingRequired).toEqual(['number', 'status', 'openedAt']);
  });

  it('keeps the suggestion for the person who asked, without the values from their file', async () => {
    const s = await setup();
    const made = (
      await s.pm.browser.post(`${s.base}/ai/import-mappings`, { entity: 'rfi', columns: RFI_LOG })
    ).json();

    const listed = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=import.mapping`)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: made.suggestionId,
      task: 'import.mapping',
      targetType: 'project',
      targetId: s.project.id,
      status: 'pending',
      runId: made.runId,
      payload: { entity: 'rfi', missingRequired: [] },
    });
    // Headers and the meaning of each status are kept; names and subjects from the file are not.
    const stored = JSON.stringify(listed.data[0].payload);
    expect(stored).toContain('Ball In Court');
    expect(stored).not.toContain('Sam Nguyen');
    expect(stored).not.toContain('Fire rating');

    // Another admin sees only their own suggestion, and can't decide the first person's.
    const second = await s.mgr.browser.post(`${s.base}/ai/import-mappings`, {
      entity: 'rfi',
      columns: RFI_LOG,
    });
    expect(second.statusCode).toBe(200);
    const theirs = (await s.mgr.browser.get(`${s.base}/ai/suggestions?task=import.mapping`)).json();
    expect(theirs.data.map((x: { id: string }) => x.id)).toEqual([second.json().suggestionId]);
    const stolen = await s.mgr.browser.post(
      `${s.base}/ai/suggestions/${made.suggestionId}/decision`,
      { decision: 'accepted' },
    );
    expect(stolen.statusCode).toBe(404);

    // The person confirms with changes, once.
    const decided = await s.pm.browser.post(
      `${s.base}/ai/suggestions/${made.suggestionId}/decision`,
      { decision: 'edited' },
    );
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ id: made.suggestionId, status: 'edited' });
    expect(
      (
        await s.pm.browser.post(`${s.base}/ai/suggestions/${made.suggestionId}/decision`, {
          decision: 'accepted',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('knows the other kinds of record', async () => {
    const s = await setup();
    const post = async (entity: string, columns: ReturnType<typeof col>[]) =>
      (await s.pm.browser.post(`${s.base}/ai/import-mappings`, { entity, columns })).json();
    const defects = await post('defect', [
      col('Item #', ['1']),
      col('Title', ['Paint runs']),
      col('Status', ['Open'], ['Initiated', 'Work Required', 'Ready to Close']),
      col('Priority', ['High'], ['Low', 'Urgent']),
    ]);
    expect(defects.columns.map((c: { field: string }) => c.field)).toEqual([
      'number',
      'title',
      'status',
      'priority',
    ]);
    expect(defects.values[0].pairs.map((p: { value: string }) => p.value)).toEqual([
      'draft',
      'open',
      'ready_for_review',
    ]);
    expect(defects.values[1].pairs.map((p: { value: string }) => p.value)).toEqual([
      'low',
      'critical',
    ]);
    const register = await post('drawing_register', [
      col('Dwg No', ['A-301']),
      col('Drawing Title', ['Level 3 Floor Plan']),
      col('Rev', ['D']),
    ]);
    expect(register.missingRequired).toEqual([]);
    const companies = await post('company', [
      col('Business Name', ['Brush Co']),
      col('ABN', ['51 824 753 556']),
      col('Email', ['sam@brush.example']),
    ]);
    expect(companies.columns.map((c: { field: string }) => c.field)).toEqual([
      'name',
      'abn',
      'email',
    ]);
  });

  it('checks the request and who is asking', async () => {
    const s = await setup();
    const post = (body: object, who: { browser: typeof s.pm.browser } = s.pm) =>
      who.browser.post(`${s.base}/ai/import-mappings`, body);

    expect((await post({ entity: 'invoice', columns: RFI_LOG })).statusCode).toBe(422);
    expect((await post({ entity: 'rfi', columns: [] })).statusCode).toBe(422);
    expect((await post({ entity: 'rfi' })).statusCode).toBe(422);
    expect(
      (await post({ entity: 'rfi', columns: Array.from({ length: 81 }, () => col('A', ['x'])) }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post({ entity: 'rfi', columns: [col('A', ['1', '2', '3', '4', '5', '6'])] }))
        .statusCode,
    ).toBe(422);
    expect((await post({ entity: 'rfi', columns: [col('A', ['x'.repeat(101)])] })).statusCode).toBe(
      422,
    );
    // A file with nothing in it is no file.
    const empty = await post({ entity: 'rfi', columns: [col('', [])] });
    expect(empty.statusCode).toBe(422);

    // Only project admins run imports; a stranger can't reach the project.
    expect((await post({ entity: 'rfi', columns: RFI_LOG }, s.sub)).statusCode).toBe(403);
    expect((await post({ entity: 'rfi', columns: RFI_LOG }, s.site)).statusCode).toBe(403);
    const stranger = await signUp(t.app, 'imap-stranger');
    expect([403, 404]).toContain(
      (await post({ entity: 'rfi', columns: RFI_LOG }, stranger)).statusCode,
    );
  });
});
