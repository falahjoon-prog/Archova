import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// Items linked to an RFI show up for that RFI (product/07 MTG-AC5), through the real meetings and rfis modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Detail = { meeting: { id: string }; sections: Array<{ id: string; title: string }> };
type Linked = Array<{ meetingTitle: string; itemNo: string; body: string; status: string }>;

describe('Related meetings (MTG-AC5)', () => {
  it('lists the minute items linked to an RFI, once per carried item, for the project team only', async () => {
    const pm = await signUp(t.app, 'rel-pm');
    const sub = await signUp(t.app, 'rel-sub');
    const org = await createOrg(pm.browser, 'Related Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower R', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');

    const draft = await pm.browser.post(`${base}/rfis`, {
      subject: 'Slab edge detail',
      question: 'Which detail governs?',
      assigneeIds: [pm.userId],
    });
    const rfiId = draft.json().rfi.id as string;
    const other = (
      await pm.browser.post(`${base}/rfis`, {
        subject: 'Other',
        question: 'Another question?',
        assigneeIds: [pm.userId],
      })
    ).json().rfi.id as string;

    const series = (
      await pm.browser.post(`${base}/meeting-series`, {
        name: 'Site meeting',
        template: 'site_coordination',
        defaultAttendees: [{ name: 'Dana PM', companyName: 'Related Builder', role: 'PM' }],
      })
    ).json();
    const first = (
      await pm.browser.post(`${base}/meeting-series/${series.id}/meetings`, {
        heldAt: new Date().toISOString(),
      })
    ).json() as Detail;
    const general = first.sections.find((s) => s.title === 'RFIs')!;

    const linked = await pm.browser.post(`${base}/meetings/${first.meeting.id}/items`, {
      sectionId: general.id,
      kind: 'action',
      body: 'Engineer to confirm the slab edge detail',
      link: { type: 'rfi', id: rfiId },
    });
    expect(linked.statusCode).toBe(201);
    await pm.browser.post(`${base}/meetings/${first.meeting.id}/items`, {
      sectionId: general.id,
      kind: 'information',
      body: 'Unrelated note',
      link: { type: 'rfi', id: other },
    });

    const get = async (id: string, who = pm.browser) =>
      who.get(`${base}/meeting-links?type=rfi&id=${id}`);
    let r = await get(rfiId);
    expect(r.statusCode).toBe(200);
    expect((r.json().data as Linked).map((x) => x.body)).toEqual([
      'Engineer to confirm the slab edge detail',
    ]);

    // The open action is carried into the next meeting: still one row, now from the newer meeting.
    await pm.browser.post(`${base}/meeting-series/${series.id}/meetings`, {
      heldAt: new Date(Date.now() + 86400000).toISOString(),
    });
    r = await get(rfiId);
    const rows = r.json().data as Linked;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', itemNo: expect.stringMatching(/^\d+\.\d+$/) });

    // A bad id is a validation problem; an outsider gets nothing.
    expect((await get('rfi_not-an-id')).statusCode).toBe(422);
    const out = await get(rfiId, sub.browser);
    expect(out.statusCode).toBe(200);
    expect(out.json().data).toEqual([]);
  });
});
