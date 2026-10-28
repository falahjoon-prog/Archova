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

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const sub2 = await signUp(t.app, `${label}-sub2`);
  const eng = await signUp(t.app, `${label}-eng`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Formco',
  );
  const sub2Co = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub2.email,
    'Subcontractor',
    'Sparky',
  );
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Engineers');
  const site = await sm.browser.post(`${base}/attendance/sites`, { name: 'Main site' });
  expect(site.statusCode).toBe(201);
  const gate = await sm.browser.post(`${base}/attendance/sites/${site.json().id}/gates`, {
    name: 'Main gate',
  });
  expect(gate.statusCode).toBe(201);
  return {
    pm,
    sm,
    sub,
    sub2,
    eng,
    org,
    project,
    base,
    subCo,
    sub2Co,
    site: site.json(),
    gate: gate.json().gate,
    code: gate.json().code as string,
  };
}

describe('mobile pull: attendance sessions', () => {
  it('sends a manager every session, a subcontractor only their own, and a consultant nothing', async () => {
    const s = await setup('wf-sync');
    const signIn = async (who: typeof s.sub) => {
      const res = await who.browser.post(`${s.base}/attendance/sign-in`, { gateCode: s.code });
      expect(res.json().outcome).toBe('accepted');
      return res.json().session.id as string;
    };
    const mine = await signIn(s.sub);
    const theirs = await signIn(s.sub2);
    await signIn(s.eng);

    const pull = async (who: typeof s.sub) =>
      (
        await who.browser.get(
          `/v1/orgs/${s.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${s.project.id}:workforce`)}&since=0`,
        )
      ).json() as {
        changes: Array<{ id: string; op: string; version: number }>;
        revokedScopes: unknown[];
      };
    const summary = (p: Awaited<ReturnType<typeof pull>>) =>
      Object.fromEntries(p.changes.map((c) => [c.id, `${c.op}:${c.version > 0 ? 'v' : '0'}`]));

    const manager = summary(await pull(s.sm));
    expect(manager[mine]).toBe('upsert:v');
    expect(manager[theirs]).toBe('upsert:v');
    expect(Object.keys(manager)).toHaveLength(3);

    const own = summary(await pull(s.sub));
    expect(own[mine]).toBe('upsert:v');
    expect(own[theirs]).toBe('delete:0');

    const consultant = await pull(s.eng);
    expect(consultant.changes).toEqual([]);
    expect(consultant.revokedScopes).toHaveLength(1);
  });
});
