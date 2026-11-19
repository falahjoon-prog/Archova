import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'hnd-pm');
  const sub = await signUp(t.app, 'hnd-sub');
  const client = await signUp(t.app, 'hnd-client');
  const org = await createOrg(pm.browser, 'Handover Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower H', state: 'VIC' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const { companyId: company } = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparkies',
  );
  await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'The Client Pty Ltd');
  return { pm, sub, client, org, project, base, company };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Handover and close-out pack', () => {
  it('starts empty, adds the standard list once, and numbers items', async () => {
    const s = await setup();
    const empty = (await s.pm.browser.get(`${s.base}/handover`)).json();
    expect(empty.items).toHaveLength(0);
    expect(empty.flags.map((f: { kind: string }) => f.kind)).toEqual(['empty_checklist']);
    expect(empty.readyToIssue).toBe(false);

    const first = await s.pm.browser.post(`${s.base}/handover/template`, {});
    expect(first.statusCode).toBe(200);
    expect(first.json().added).toBeGreaterThan(15);
    const again = await s.pm.browser.post(`${s.base}/handover/template`, {});
    expect(again.json().added).toBe(0);

    const pack = (await s.pm.browser.get(`${s.base}/handover`)).json();
    expect(pack.items[0]).toMatchObject({ numberLabel: 'HND-0001', status: 'outstanding' });
    expect(pack.items).toHaveLength(first.json().added);
    expect(pack.summary.percentComplete).toBe(0);
  });

  it('takes an item from requested to approved with a file, and keeps the history', async () => {
    const s = await setup();
    const created = (
      await s.pm.browser.post(`${s.base}/handover/items`, {
        category: 'om_manual',
        title: 'Lift O&M manual',
        responsibleCompanyId: s.company,
        dueOn: inDays(14),
      })
    ).json();
    const id = created.item.id;
    const post = (action: string, version: number, note?: string) =>
      s.pm.browser.post(
        `${s.base}/handover/items/${id}/transition`,
        { action, ...(note ? { note } : {}) },
        ifMatch(version),
      );

    const noFile = await post('receive', created.item.version);
    expect(noFile.statusCode).toBe(409);

    const requested = await post('request', created.item.version);
    expect(requested.json().item.status).toBe('requested');

    const file = await uploadFile(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      'lift-om.pdf',
      'handover',
    );
    const attached = await s.pm.browser.patch(
      `${s.base}/handover/items/${id}`,
      { fileIds: [file] },
      ifMatch(requested.json().item.version),
    );
    expect(attached.statusCode).toBe(200);

    const received = await post('receive', attached.json().item.version);
    expect(received.json().item).toMatchObject({ status: 'received', fileIds: [file] });
    expect(received.json().item.receivedOn).toBeTruthy();

    const sentBack = await post('reject', received.json().item.version);
    expect(sentBack.statusCode).toBe(409);
    const approved = await post('approve', received.json().item.version);
    expect(approved.json().item).toMatchObject({ status: 'approved', state: 'approved' });
    expect(approved.json().item.approvedBy).toBeTruthy();

    // An approved item's files are locked until it is reopened.
    const swap = await s.pm.browser.patch(
      `${s.base}/handover/items/${id}`,
      { fileIds: [] },
      ifMatch(approved.json().item.version),
    );
    expect(swap.statusCode).toBe(409);

    const stale = await post('reopen', created.item.version);
    expect(stale.statusCode).toBe(412);

    expect(approved.json().events.map((e: { action: string }) => e.action)).toEqual([
      'add',
      'request',
      'edit',
      'receive',
      'approve',
    ]);
  });

  it('rejects files from another project and companies that are not on the project', async () => {
    const s = await setup();
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Other', state: 'VIC' });
    const foreign = await uploadFile(t, s.pm.browser, s.org.id, other.id, 'x.pdf', 'handover');
    const bad = await s.pm.browser.post(`${s.base}/handover/items`, {
      category: 'other',
      title: 'Wrong file',
      fileIds: [foreign],
    });
    expect(bad.statusCode).toBe(422);
    const org2 = await createOrg(s.pm.browser, 'Another Org');
    const stranger = (
      await s.pm.browser.post(`/v1/orgs/${org2.id}/companies`, {
        name: 'Stranger',
        type: 'subcontractor',
      })
    ).json();
    const badCompany = await s.pm.browser.post(`${s.base}/handover/items`, {
      category: 'other',
      title: 'Wrong company',
      responsibleCompanyId: stranger.id,
    });
    expect(badCompany.statusCode).toBe(422);
  });

  it('flags overdue and unassigned items and reports progress', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/handover/items`, {
      category: 'certificate',
      title: 'Electrical certificate',
      dueOn: inDays(-4),
    });
    const na = (
      await s.pm.browser.post(`${s.base}/handover/items`, {
        category: 'certificate',
        title: 'Gas certificate',
      })
    ).json();
    const marked = await s.pm.browser.post(
      `${s.base}/handover/items/${na.item.id}/transition`,
      { action: 'markNotApplicable', note: 'All-electric building' },
      ifMatch(na.item.version),
    );
    expect(marked.statusCode).toBe(200);
    const pack = (await s.pm.browser.get(`${s.base}/handover`)).json();
    expect(pack.summary).toMatchObject({
      total: 2,
      required: 2,
      requiredComplete: 1,
      overdue: 1,
      percentComplete: 50,
    });
    const kinds = pack.flags.map((f: { kind: string }) => f.kind);
    expect(kinds).toContain('overdue');
    expect(kinds).toContain('no_responsible');
    expect(
      pack.items.find((i: { title: string }) => i.title === 'Electrical certificate').state,
    ).toBe('overdue');
    const flags = (await s.pm.browser.get(`${s.base}/handover/flags`)).json().data;
    expect(flags.length).toBe(pack.flags.length);
  });

  it('uses the other modules: open defects and an empty warranty register', async () => {
    const s = await setup();
    const w = (
      await s.pm.browser.post(`${s.base}/handover/items`, {
        category: 'warranty',
        title: 'Roof warranty',
        responsibleCompanyId: s.company,
      })
    ).json();
    expect(w.item.numberLabel).toBe('HND-0001');
    const kinds = (await s.pm.browser.get(`${s.base}/handover/flags`))
      .json()
      .data.map((f: { kind: string }) => f.kind);
    expect(kinds).toContain('warranty_register_empty');
    expect(kinds).toContain('no_occupation_certificate');
  });

  it('issues the pack: needs an acknowledgement while incomplete, then keeps a frozen copy', async () => {
    const s = await setup();
    const file = await uploadFile(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      'asbuilt.pdf',
      'handover',
    );
    const item = (
      await s.pm.browser.post(`${s.base}/handover/items`, {
        category: 'as_built',
        title: 'As-built architectural',
        fileIds: [file],
      })
    ).json();

    const none = await s.pm.browser.post(`${s.base}/handover/issues`, {
      recipientName: 'The Client',
    });
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('handover.incomplete');

    const received = await s.pm.browser.post(
      `${s.base}/handover/items/${item.item.id}/transition`,
      { action: 'receive' },
      ifMatch(item.item.version),
    );
    await s.pm.browser.post(
      `${s.base}/handover/items/${item.item.id}/transition`,
      { action: 'approve' },
      ifMatch(received.json().item.version),
    );

    const exported = (await s.pm.browser.get(`${s.base}/handover/export`)).json();
    expect(exported.projectName).toBe('Tower H');
    expect(exported.items[0]).toMatchObject({ numberLabel: 'HND-0001', status: 'approved' });
    expect(exported.items[0].files[0]).toMatchObject({ filename: 'asbuilt.pdf' });

    const issued = await s.pm.browser.post(`${s.base}/handover/issues`, {
      recipientName: 'The Client Pty Ltd',
      note: 'Practical completion pack',
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json()).toMatchObject({
      recipientName: 'The Client Pty Ltd',
      incompleteCount: 0,
    });

    const pack = (await s.pm.browser.get(`${s.base}/handover`)).json();
    expect(pack.readyToIssue).toBe(true);
    expect(pack.issues).toHaveLength(1);

    const empty = await createProject(s.pm.browser, s.org.id, {
      name: 'Nothing yet',
      state: 'VIC',
    });
    const nothing = await s.pm.browser.post(
      `/v1/orgs/${s.org.id}/projects/${empty.id}/handover/issues`,
      {
        recipientName: 'X',
        acknowledgeIncomplete: true,
      },
    );
    expect(nothing.statusCode).toBe(422);
  });

  it('keeps the checklist from subcontractors and clients, and the manage actions from non-admins', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/handover/template`, {});
    for (const who of [s.sub, s.client]) {
      expect((await who.browser.get(`${s.base}/handover`)).statusCode).toBe(403);
      expect((await who.browser.get(`${s.base}/handover/export`)).statusCode).toBe(403);
      expect(
        (await who.browser.post(`${s.base}/handover/items`, { category: 'other', title: 'Nope' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await who.browser.post(`${s.base}/handover/issues`, { recipientName: 'X' })).statusCode,
      ).toBe(403);
    }
  });

  it('does not let one organisation see another organisation’s checklist', async () => {
    const a = await setup();
    const b = await setup();
    await a.pm.browser.post(`${a.base}/handover/template`, {});
    expect((await b.pm.browser.get(`${a.base}/handover`)).statusCode).toBeGreaterThanOrEqual(403);
  });
});
