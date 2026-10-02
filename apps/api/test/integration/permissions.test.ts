import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createOrg, createProject, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const owner = await signUp(t.app, 'owner');
  const subbie = await signUp(t.app, 'subbie');
  const org = await createOrg(owner.browser, 'Builder Co');
  const p1 = await createProject(owner.browser, org.id, { name: 'Job 1' });
  const p2 = await createProject(owner.browser, org.id, { name: 'Job 2' });
  const company = (
    await owner.browser.post(`/v1/orgs/${org.id}/companies`, {
      name: 'Sparky Electrical',
      type: 'subcontractor',
      trades: ['electrical'],
    })
  ).json();
  const templates = (await owner.browser.get(`/v1/orgs/${org.id}/permission-templates`)).json()
    .data as Array<{ id: string; name: string }>;
  const subTemplate = templates.find((x) => x.name === 'Subcontractor')!;
  const added = await owner.browser.post(`/v1/orgs/${org.id}/projects/${p1.id}/members`, {
    email: subbie.email,
    companyId: company.id,
    permissionTemplateId: subTemplate.id,
  });
  return { owner, subbie, org, p1, p2, company, subTemplate, added };
}

describe('project members and permissions (Sam 02)', () => {
  it('adds an external collaborator who sees only their project', async () => {
    const { subbie, org, p1, p2, added } = await setup();
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ isExternal: true, status: 'active', email: subbie.email });

    const me = (await subbie.browser.get('/v1/me')).json();
    expect(me.memberships).toEqual([
      {
        orgId: org.id,
        orgName: 'Builder Co',
        orgSlug: expect.any(String),
        role: null,
        kind: 'external',
      },
    ]);

    const list = (await subbie.browser.get(`/v1/orgs/${org.id}/projects`)).json();
    expect(list.data.map((p: { id: string }) => p.id)).toEqual([p1.id]);
    expect((await subbie.browser.get(`/v1/orgs/${org.id}/projects/${p1.id}`)).statusCode).toBe(200);
    const other = await subbie.browser.get(`/v1/orgs/${org.id}/projects/${p2.id}`);
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ code: 'access.denied', reason: 'not_project_member' });
  });

  it('applies the Subcontractor template', async () => {
    const { subbie, org, p1, company, subTemplate } = await setup();
    const perms = (
      await subbie.browser.get(`/v1/orgs/${org.id}/projects/${p1.id}/permissions`)
    ).json();
    expect(perms).toMatchObject({
      orgRole: null,
      isExternal: true,
      isProjectMember: true,
      companyId: company.id,
      toolLevels: { documents: 'read', defects: 'standard', budget: 'none' },
    });
    expect(perms.companyScopedTools).toContain('defects');

    expect(
      (await subbie.browser.get(`/v1/orgs/${org.id}/projects/${p1.id}/members`)).statusCode,
    ).toBe(200);
    const manage = await subbie.browser.post(`/v1/orgs/${org.id}/projects/${p1.id}/members`, {
      email: 'x@example.com',
      companyId: company.id,
      permissionTemplateId: subTemplate.id,
    });
    expect(manage.statusCode).toBe(403);
    expect(
      (
        await subbie.browser.patch(
          `/v1/orgs/${org.id}/projects/${p1.id}`,
          { name: 'Mine' },
          { 'if-match': '"1"' },
        )
      ).statusCode,
    ).toBe(403);
    // External collaborators never get org tools.
    expect(
      (await subbie.browser.post(`/v1/orgs/${org.id}/projects`, { name: 'Nope' })).statusCode,
    ).toBe(403);
    expect((await subbie.browser.get(`/v1/orgs/${org.id}/companies`)).statusCode).toBe(403);
    expect((await subbie.browser.get(`/v1/orgs/${org.id}/permission-templates`)).statusCode).toBe(
      403,
    );
  });

  it('rejects duplicates and unknown users, companies and templates', async () => {
    const { owner, subbie, org, p1, company, subTemplate } = await setup();
    const url = `/v1/orgs/${org.id}/projects/${p1.id}/members`;
    const again = await owner.browser.post(url, {
      email: subbie.email,
      companyId: company.id,
      permissionTemplateId: subTemplate.id,
    });
    expect(again.json().code).toBe('project_member.already_exists');
    const nobody = await owner.browser.post(url, {
      email: 'nobody@example.com',
      companyId: company.id,
      permissionTemplateId: subTemplate.id,
    });
    expect(nobody.json().code).toBe('project_member.user_not_found');

    // A company id from another org is invisible under RLS.
    const stranger = await signUp(t.app, 'stranger');
    const otherOrg = await createOrg(stranger.browser, 'Other');
    const otherCompany = (await stranger.browser.get(`/v1/orgs/${otherOrg.id}/companies`)).json()
      .data[0];
    const third = await signUp(t.app, 'third');
    const cross = await owner.browser.post(url, {
      email: third.email,
      companyId: otherCompany.id,
      permissionTemplateId: subTemplate.id,
    });
    expect(cross.json().code).toBe('company.not_found');
  });

  it('lists all projects for owners and lists members with names', async () => {
    const { owner, org, p1 } = await setup();
    const list = (await owner.browser.get(`/v1/orgs/${org.id}/projects`)).json();
    expect(list.data).toHaveLength(2);
    const members = (
      await owner.browser.get(`/v1/orgs/${org.id}/projects/${p1.id}/members`)
    ).json();
    expect(members.data).toHaveLength(2);
    expect(members.data[0]).toMatchObject({ isExternal: false, name: 'owner tester' });
  });
});
