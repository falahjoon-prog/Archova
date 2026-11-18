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
  const pm = await signUp(t.app, 'corp-pm');
  const steel = await signUp(t.app, 'corp-steel');
  const plumb = await signUp(t.app, 'corp-plumb');
  const stranger = await signUp(t.app, 'corp-stranger');
  const org = await createOrg(pm.browser, 'Private Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower Q', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const steelCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    steel.email,
    'Subcontractor',
    'Steelco',
  );
  await addMember(pm.browser, org.id, project.id, plumb.email, 'Subcontractor', 'Plumbco');
  const type = (
    await pm.browser.post(`/v1/orgs/${org.id}/correspondence-types`, {
      name: 'Notice to proceed',
      prefix: 'NTP',
      fields: [
        { key: 'startDate', label: 'Construction Start Date', kind: 'date', required: true },
        { key: 'liquidated', label: 'Liquidated damages apply', kind: 'yesNo', required: false },
      ],
    })
  ).json();
  return { pm, steel, plumb, stranger, org, project, base, steelCo, type };
}

type S = Awaited<ReturnType<typeof setup>>;
const draft = async (s: S, over: object = {}) => {
  const res = await s.pm.browser.post(`${s.base}/correspondence`, {
    typeId: s.type.id,
    subject: 'Start on site',
    body: 'You may start.',
    fromCompanyId: undefined,
    toCompanyIds: [s.steelCo.companyId],
    ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().item as { id: string; version: number };
};
const send = async (s: S, id: string) => {
  const got = await s.pm.browser.get(`${s.base}/correspondence/${id}`);
  return s.pm.browser.post(`${s.base}/correspondence/${id}/send`, undefined, {
    'if-match': got.headers.etag as string,
  });
};

describe('correspondence type fields (Construction Start Date style)', () => {
  it("checks a type's field list and each item's values against it, and asks for required ones at send", async () => {
    const s = await setup();
    expect(s.type.fields).toHaveLength(2);
    const types = `/v1/orgs/${s.org.id}/correspondence-types`;
    const dupKey = await s.pm.browser.post(types, {
      name: 'Bad',
      prefix: 'BAD',
      fields: [
        { key: 'a', label: 'A', kind: 'text', required: false },
        { key: 'a', label: 'A again', kind: 'text', required: false },
      ],
    });
    expect(dupKey.json().code).toBe('validation_failed');

    const unknown = await s.pm.browser.post(`${s.base}/correspondence`, {
      typeId: s.type.id,
      fieldValues: { nope: 'x' },
    });
    expect(unknown.json().code).toBe('validation_failed');
    const wrongKind = await s.pm.browser.post(`${s.base}/correspondence`, {
      typeId: s.type.id,
      fieldValues: { startDate: 'tomorrow' },
    });
    expect(wrongKind.json().code).toBe('validation_failed');

    const item = await draft(s);
    const early = await send(s, item.id);
    expect(early.json().code).toBe('correspondence.incomplete');
    expect(JSON.stringify(early.json())).toContain('fieldValues/startDate');

    const got = await s.pm.browser.get(`${s.base}/correspondence/${item.id}`);
    const patched = await s.pm.browser.patch(
      `${s.base}/correspondence/${item.id}`,
      { fieldValues: { startDate: '2027-03-01', liquidated: true } },
      { 'if-match': got.headers.etag as string },
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item.fieldValues).toEqual({ startDate: '2027-03-01', liquidated: true });
    expect((await send(s, item.id)).statusCode).toBe(200);
  });
});

describe('private correspondence', () => {
  it('shows a private item only to its author, admins and the people listed, and lets only the author change the list', async () => {
    const s = await setup();
    const item = await draft(s, { fieldValues: { startDate: '2027-03-01' } });
    const url = `${s.base}/correspondence/${item.id}`;

    // Not private yet: the recipient sees it once sent.
    const strangerId = s.stranger.userId;
    const notOnProject = await s.pm.browser.put(`${url}/access`, {
      isPrivate: true,
      userIds: [strangerId],
    });
    expect(notOnProject.json().code).toBe('validation_failed');

    const set = await s.pm.browser.put(`${url}/access`, { isPrivate: true, userIds: [] });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ isPrivate: true, userIds: [] });
    expect((await send(s, item.id)).statusCode).toBe(200);

    // The addressed company's person is not listed, so it does not exist for them.
    expect((await s.steel.browser.get(url)).statusCode).toBe(404);
    const steelList = (await s.steel.browser.get(`${s.base}/correspondence`)).json().data;
    expect(steelList.map((i: { id: string }) => i.id)).not.toContain(item.id);
    expect((await s.steel.browser.get(`${url}/history`)).statusCode).toBe(404);

    // The author reads it and the list; a listed person cannot.
    const seen = await s.pm.browser.get(url);
    expect(seen.json()).toMatchObject({ canManageAccess: true, item: { isPrivate: true } });
    await s.pm.browser.put(`${url}/access`, { isPrivate: true, userIds: [s.steel.userId] });
    const open = await s.steel.browser.get(url);
    expect(open.statusCode).toBe(200);
    expect(open.json()).toMatchObject({ canManageAccess: false, item: { isPrivate: true } });
    const steelList2 = (await s.steel.browser.get(`${s.base}/correspondence`)).json().data;
    expect(steelList2.map((i: { id: string }) => i.id)).toContain(item.id);
    expect((await s.steel.browser.get(`${url}/access`)).statusCode).toBe(403);
    expect(
      (await s.steel.browser.put(`${url}/access`, { isPrivate: false, userIds: [] })).statusCode,
    ).toBe(403);
    // Someone else on the project, not listed, still cannot see it.
    expect((await s.plumb.browser.get(url)).statusCode).toBe(404);
    expect((await s.pm.browser.get(`${url}/access`)).json()).toEqual({
      isPrivate: true,
      userIds: [s.steel.userId],
    });

    // Taking it off private shows it to the addressed company again.
    await s.pm.browser.put(`${url}/access`, { isPrivate: false, userIds: [] });
    expect((await s.steel.browser.get(url)).statusCode).toBe(200);
    expect((await s.plumb.browser.get(url)).statusCode).toBe(404);
  });
});

describe('correspondence change history', () => {
  it('records who did what and what an edit changed, for anyone who can open the item', async () => {
    const s = await setup();
    const item = await draft(s);
    const url = `${s.base}/correspondence/${item.id}`;
    const got = await s.pm.browser.get(url);
    await s.pm.browser.patch(
      url,
      { subject: 'Start on site (revised)', fieldValues: { startDate: '2027-04-01' } },
      { 'if-match': got.headers.etag as string },
    );
    await s.pm.browser.put(`${url}/access`, { isPrivate: false, userIds: [] });
    await send(s, item.id).then((r) => expect(r.statusCode).toBe(200));

    const hist = await s.steel.browser.get(`${url}/history`);
    expect(hist.statusCode).toBe(200);
    const rows = hist.json().data as Array<{
      action: string;
      byUser: string;
      changes: Array<{ field: string; from: unknown; to: unknown }>;
    }>;
    expect(rows.map((r) => r.action)).toEqual(['created', 'edited', 'sent']);
    expect(rows.every((r) => r.byUser === s.pm.userId)).toBe(true);
    expect(rows[1]!.changes).toEqual(
      expect.arrayContaining([
        { field: 'subject', from: 'Start on site', to: 'Start on site (revised)' },
        { field: 'fieldValues', from: {}, to: { startDate: '2027-04-01' } },
      ]),
    );
  });
});
