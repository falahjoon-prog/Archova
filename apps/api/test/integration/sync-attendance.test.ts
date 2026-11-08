import { randomUUID } from 'node:crypto';
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

describe('attendance.signOut push command', () => {
  it('closes only the sender’s own session, at the time the phone recorded, and replays', async () => {
    const pm = await signUp(t.app, 'att-pm');
    const sm = await signUp(t.app, 'att-sm');
    const a = await signUp(t.app, 'att-a');
    const b = await signUp(t.app, 'att-b');
    const org = await createOrg(pm.browser, 'Att Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', 'Att Builder');
    await addMember(pm.browser, org.id, project.id, a.email, 'Subcontractor', 'Formco');
    await addMember(pm.browser, org.id, project.id, b.email, 'Subcontractor', 'Sparky');
    const site = await sm.browser.post(`${base}/attendance/sites`, { name: 'Main site' });
    const gate = await sm.browser.post(`${base}/attendance/sites/${site.json().id}/gates`, {
      name: 'Main gate',
    });
    const code = gate.json().code as string;
    const signIn = async (who: typeof a) => {
      const res = await who.browser.post(`${base}/attendance/sign-in`, { gateCode: code });
      expect(res.json().outcome).toBe('accepted');
      return res.json().session.id as string;
    };
    const mine = await signIn(a);
    const theirs = await signIn(b);
    const push = async (who: typeof a, entityId: string, clientAt: string) => {
      const res = await who.browser.post(`/v1/orgs/${org.id}/sync/push`, {
        mutations: [
          {
            mutationId: randomUUID(),
            command: 'attendance.signOut',
            entityId,
            baseVersion: null,
            clientAt,
            payload: {},
          },
        ],
      });
      expect(res.statusCode).toBe(200);
      return res.json().results[0] as {
        status: string;
        version?: number;
        problem?: { code: string };
      };
    };
    const at = new Date().toISOString();

    // Someone else's session reads as not found.
    const stranger = await push(a, theirs, at);
    expect(stranger.status).toBe('rejected');
    expect(stranger.problem?.code).toBe('attendance.session_not_found');

    const ok = await push(a, mine, at);
    expect(ok.status).toBe('applied');
    expect(ok.version).toBe(2);

    // A second sign-out of the same session is refused: the worker is already off site.
    const again = await push(a, mine, at);
    expect(again.status).toBe('rejected');
    expect(again.problem?.code).toBe('attendance.not_on_site');
  });
});
