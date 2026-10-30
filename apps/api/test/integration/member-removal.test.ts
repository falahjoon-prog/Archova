import { decodeId } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  addMember,
  outboxData,
} from './helpers';
import type { TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('removing someone from a project (X38)', () => {
  it('ends their access with a recorded kind, refuses odd cases, and a re-add starts a new episode', async () => {
    const pm = await signUp(t.app, 'rm-pm');
    const sub = await signUp(t.app, 'rm-sub');
    const org = await createOrg(pm.browser, 'Removal Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
    const members = (await pm.browser.get(`${base}/members`)).json().data as Array<{
      id: string;
      email: string;
      userId: string;
      companyId: string;
      permissionTemplateId: string;
    }>;
    const subMember = members.find((m) => m.email === sub.email)!;
    const pmMember = members.find((m) => m.email === pm.email)!;
    expect((await sub.browser.get(base)).statusCode).toBe(200);

    // Not for yourself, not without the manage permission, not for someone who is not on the project.
    const self = await pm.browser.post(`${base}/members/${pmMember.id}/remove`, {
      kind: 'ordinary',
    });
    expect(self.json().code).toBe('project_member.cannot_remove_self');
    expect(
      (await sub.browser.post(`${base}/members/${pmMember.id}/remove`, { kind: 'ordinary' }))
        .statusCode,
    ).toBe(403);
    const unknown = await pm.browser.post(`${base}/members/pmb_00000000000000000000000000/remove`, {
      kind: 'ordinary',
    });
    expect(unknown.statusCode).toBe(404);
    expect(
      (await pm.browser.post(`${base}/members/${subMember.id}/remove`, { kind: 'banished' }))
        .statusCode,
    ).toBe(422);

    const removed = await pm.browser.post(`${base}/members/${subMember.id}/remove`, {
      kind: 'ordinary',
      reason: 'Finished on site',
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().status).toBe('removed');
    expect(
      (await pm.browser.get(`${base}/members`))
        .json()
        .data.some((m: { id: string }) => m.id === subMember.id),
    ).toBe(false);
    expect([403, 404]).toContain((await sub.browser.get(base)).statusCode);
    expect(
      (await pm.browser.post(`${base}/members/${subMember.id}/remove`, { kind: 'ordinary' })).json()
        .code,
    ).toBe('project_member.not_found');
    expect(await outboxData(t, org.id, pm.userId, 'platform.project_member.removed.v1')).toEqual([
      expect.objectContaining({ userId: decodeId('user', subMember.userId), kind: 'ordinary' }),
    ]);

    // Adding them again gives access back as a new episode.
    const again = await pm.browser.post(`${base}/members`, {
      email: sub.email,
      companyId: subMember.companyId,
      permissionTemplateId: subMember.permissionTemplateId,
    });
    expect(again.statusCode).toBe(201);
    expect(again.json()).toMatchObject({ id: subMember.id, status: 'active' });
    expect((await sub.browser.get(base)).statusCode).toBe(200);
    const dup = await pm.browser.post(`${base}/members`, {
      email: sub.email,
      companyId: subMember.companyId,
      permissionTemplateId: subMember.permissionTemplateId,
    });
    expect(dup.json().code).toBe('project_member.already_exists');
  });
});
