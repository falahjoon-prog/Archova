import { PDFDocument } from 'pdf-lib';
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
  const pm = await signUp(t.app, 'mtg-pm');
  const sub = await signUp(t.app, 'mtg-sub');
  const other = await signUp(t.app, 'mtg-other');
  const org = await createOrg(pm.browser, 'Meeting Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower M', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky',
  );
  await addMember(pm.browser, org.id, project.id, other.email, 'Subcontractor', 'Tilers R Us');
  const subUserId = (
    (await pm.browser.get(`${base}/members`)).json().data as Array<{
      userId: string;
      email?: string;
      name: string;
    }>
  ).find((m) => m.email === sub.email)?.userId;
  return { pm, sub, other, org, project, base, subCo, subUserId };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
type Detail = {
  meeting: { id: string; version: number; number: number; status: string; issuedVersion: number };
  attendees: Array<{ id: string; name: string }>;
  sections: Array<{
    id: string;
    title: string;
    internalOnly: boolean;
    items: Array<{
      id: string;
      itemNo: string;
      kind: string;
      status: string;
      carriedCount: number;
      version: number;
      body: string;
      history: unknown[];
      stale: boolean;
    }>;
  }>;
  versions: Array<{ version: number; recipients: unknown[] }>;
  viewer: { audience: string; canEdit: boolean; canIssue: boolean; viewingVersion: number | null };
};

describe('Meetings, minutes and actions (product/07)', () => {
  it('carries open actions into the next meeting, keeps their numbers, and issues versioned minutes', async () => {
    const s = await setup();
    const series = await s.pm.browser.post(`${s.base}/meeting-series`, {
      name: 'Project control group',
      template: 'pcg',
      cadence: 'Monthly',
      defaultAttendees: [
        { name: 'Dana PM', companyName: 'Meeting Builder', role: 'PM', email: 'dana@example.com' },
        { name: 'Sam Sparky', companyName: 'Sparky', companyId: s.subCo.companyId },
      ],
    });
    expect(series.statusCode).toBe(201);
    const seriesBody = series.json();
    expect(seriesBody.agenda.map((a: { title: string }) => a.title)).toContain(
      'Builder only: commercial',
    );

    const m1 = await s.pm.browser.post(`${s.base}/meeting-series/${seriesBody.id}/meetings`, {
      heldAt: '2030-03-04T22:00:00Z',
      location: 'Site office',
    });
    expect(m1.statusCode).toBe(201);
    let d: Detail = m1.json();
    expect(d.meeting.number).toBe(1);
    expect(d.attendees.map((a) => a.name)).toEqual(['Dana PM', 'Sam Sparky']);
    const safety = d.sections.find((x) => x.title === 'Safety')!;
    const commercial = d.sections.find((x) => x.internalOnly)!;
    const meeting1 = d.meeting.id;

    const action = await s.pm.browser.post(`${s.base}/meetings/${meeting1}/items`, {
      sectionId: safety.id,
      kind: 'action',
      body: 'Fix the edge protection on level 3',
      ownerCompanyId: s.subCo.companyId,
      dueDate: '2030-03-10',
    });
    expect(action.statusCode).toBe(201);
    await s.pm.browser.post(`${s.base}/meetings/${meeting1}/items`, {
      sectionId: safety.id,
      kind: 'decision',
      body: 'Client approved the revised crane position',
    });
    await s.pm.browser.post(`${s.base}/meetings/${meeting1}/items`, {
      sectionId: commercial.id,
      kind: 'information',
      body: 'Margin on the facade package is thin',
    });
    d = (await s.pm.browser.get(`${s.base}/meetings/${meeting1}`)).json();
    const items = d.sections.find((x) => x.id === safety.id)!.items;
    expect(items.map((i) => [i.itemNo, i.kind, i.status])).toEqual([
      ['1.1', 'action', 'open'],
      ['1.2', 'decision', 'closed'],
    ]);

    // A subcontractor attendee sees nothing until the minutes are issued, and cannot write.
    expect((await s.sub.browser.get(`${s.base}/meetings/${meeting1}`)).statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/meetings`)).json().data).toEqual([]);
    expect((await s.sub.browser.get(`${s.base}/meeting-actions`)).json().data).toEqual([]);
    const denied = await s.sub.browser.post(`${s.base}/meetings/${meeting1}/items`, {
      sectionId: safety.id,
      kind: 'action',
      body: 'Sneaky',
    });
    expect(denied.statusCode).toBe(403);

    // Issue freezes version 1 and records who it went to.
    const noAttendees = await s.pm.browser.post(`${s.base}/meetings/${meeting1}/issue`, {
      recipients: [],
    });
    expect(noAttendees.statusCode).toBe(200);
    d = noAttendees.json();
    expect(d.meeting).toMatchObject({ status: 'issued', issuedVersion: 1 });
    const issued = await s.pm.browser.post(`${s.base}/meetings/${meeting1}/issue`, {
      recipients: [
        { name: 'Sam Sparky', email: 'sam@example.com' },
        { name: 'Sam again', email: 'SAM@example.com' },
      ],
      correctionsBy: '2030-03-08',
      note: 'Corrected the due date',
    });
    d = issued.json();
    expect(d.meeting.issuedVersion).toBe(2);
    expect(d.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(d.versions[1]!.recipients).toEqual([{ name: 'Sam Sparky', email: 'sam@example.com' }]);

    // Outsiders see the issued minutes without the internal-only section, with their own action in their list.
    const seen = await s.sub.browser.get(`${s.base}/meetings/${meeting1}`);
    expect(seen.statusCode).toBe(200);
    const sd: Detail = seen.json();
    expect(sd.viewer).toMatchObject({ audience: 'external', canEdit: false, viewingVersion: 2 });
    expect(sd.sections.some((x) => x.internalOnly)).toBe(false);
    expect(
      sd.attendees.every((a) => !('email' in a) || (a as { email: unknown }).email === null),
    ).toBe(true);
    expect((await s.other.browser.get(`${s.base}/meetings/${meeting1}`)).statusCode).toBe(404);
    const mine = (await s.sub.browser.get(`${s.base}/meeting-actions`)).json().data;
    expect(mine).toHaveLength(1);
    // `version` is what a phone sends as If-Match to close the action.
    expect(mine[0]).toMatchObject({
      itemNo: '1.1',
      body: 'Fix the edge protection on level 3',
      version: expect.any(Number),
    });
    expect((await s.other.browser.get(`${s.base}/meeting-actions`)).json().data).toEqual([]);

    // Both versions stay downloadable; the outsider's PDF leaves the internal section out.
    const pdf = await s.pm.browser.get(`${s.base}/meetings/${meeting1}/versions/1/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json()).toMatchObject({ contentType: 'application/pdf' });
    expect(
      (await PDFDocument.load(Buffer.from(pdf.json().dataBase64, 'base64'))).getPageCount(),
    ).toBe(1);
    expect(
      (await s.sub.browser.get(`${s.base}/meetings/${meeting1}/versions/2/pdf`)).statusCode,
    ).toBe(200);
    expect(
      (await s.sub.browser.get(`${s.base}/meetings/${meeting1}/versions/3/pdf`)).statusCode,
    ).toBe(404);
    expect(
      (await s.other.browser.get(`${s.base}/meetings/${meeting1}/versions/2/pdf`)).statusCode,
    ).toBe(404);

    // The next meeting starts from this one: the open action is back with its number and history; the decision is not.
    const m2 = await s.pm.browser.post(`${s.base}/meeting-series/${seriesBody.id}/meetings`, {
      heldAt: '2030-04-01T22:00:00Z',
    });
    d = m2.json();
    expect(d.meeting.number).toBe(2);
    const carried = d.sections.find((x) => x.title === 'Safety')!.items;
    expect(carried.map((i) => [i.itemNo, i.carriedCount, i.history.length])).toEqual([
      ['1.1', 1, 1],
    ]);
    expect(d.sections.find((x) => x.internalOnly)!.items).toEqual([]);

    // A new item in the same section takes 1.3, never the number of the decision that was not carried.
    const added = await s.pm.browser.post(`${s.base}/meetings/${d.meeting.id}/items`, {
      sectionId: d.sections.find((x) => x.title === 'Safety')!.id,
      kind: 'action',
      body: 'Order the scaffold inspection',
    });
    const after: Detail = added.json();
    expect(after.sections.find((x) => x.title === 'Safety')!.items.map((i) => i.itemNo)).toEqual([
      '1.1',
      '1.3',
    ]);

    // A carried item cannot be deleted, only closed; closing stops it carrying on.
    const c = after.sections.find((x) => x.title === 'Safety')!.items[0]!;
    const del = await s.pm.browser.del(`${s.base}/meeting-items/${c.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('meeting.item_carried');
    const stale = await s.pm.browser.patch(
      `${s.base}/meeting-items/${c.id}`,
      { status: 'closed' },
      ifMatch(c.version + 5),
    );
    expect(stale.statusCode).toBe(412);
    const closed = await s.pm.browser.patch(
      `${s.base}/meeting-items/${c.id}`,
      { status: 'closed' },
      ifMatch(c.version),
    );
    expect(closed.statusCode).toBe(200);
    const m3: Detail = (
      await s.pm.browser.post(`${s.base}/meeting-series/${seriesBody.id}/meetings`, {
        heldAt: '2030-05-06T22:00:00Z',
      })
    ).json();
    expect(m3.sections.find((x) => x.title === 'Safety')!.items.map((i) => i.itemNo)).toEqual([
      '1.3',
    ]);

    // Only the latest meeting's copy is the live action.
    const live = (await s.pm.browser.get(`${s.base}/meeting-actions?scope=all`)).json().data;
    expect(
      live.map((a: { itemNo: string; meetingNumber: number }) => [a.itemNo, a.meetingNumber]),
    ).toEqual([['1.3', 3]]);
    const list = (await s.pm.browser.get(`${s.base}/meetings?seriesId=${seriesBody.id}`)).json()
      .data;
    expect(
      list.map((x: { number: number; openActions: number }) => [x.number, x.openActions]),
    ).toEqual([
      [3, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  it('refuses a meeting in another project and rejects bad ids', async () => {
    const s = await setup();
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Other', state: 'QLD' });
    const series = (await s.pm.browser.post(`${s.base}/meeting-series`, { name: 'Site' })).json();
    const m = (
      await s.pm.browser.post(`${s.base}/meeting-series/${series.id}/meetings`, {
        heldAt: '2030-03-04T22:00:00Z',
      })
    ).json();
    const otherBase = `/v1/orgs/${s.org.id}/projects/${other.id}`;
    expect((await s.pm.browser.get(`${otherBase}/meetings/${m.meeting.id}`)).statusCode).toBe(404);
    const bad = await s.pm.browser.post(`${s.base}/meetings/${m.meeting.id}/items`, {
      sectionId: m.sections[0].id,
      kind: 'action',
      body: 'Check the RFI',
      link: { type: 'rfi', id: 'dfx_00000000000000000000000000' },
    });
    expect(bad.statusCode).toBe(422);
  });
});
