import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createOrg, createProject, createTestContext, signUp } from './helpers';
import type { TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('project directory and company contacts', () => {
  it('keeps phone, title and trade, searches and filters the directory', async () => {
    const pm = await signUp(t.app, 'dir-pm');
    const sub = await signUp(t.app, 'dir-sub');
    const org = await createOrg(pm.browser, 'Directory Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Dock Rd', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(
      pm.browser,
      org.id,
      project.id,
      sub.email,
      'Subcontractor',
      'Sparky Electrical',
    );
    const list = async (qs = '') =>
      (await pm.browser.get(`${base}/members${qs}`)).json().data as Array<{
        id: string;
        email: string;
        companyId: string;
        phone: string | null;
        jobTitle: string | null;
        trade: string | null;
      }>;
    const all = await list();
    const subMember = all.find((m) => m.email === sub.email)!;
    expect(subMember).toMatchObject({ phone: null, jobTitle: null, trade: null });

    // Only someone who manages members can edit; blanks clear a field.
    expect(
      (await sub.browser.patch(`${base}/members/${subMember.id}`, { phone: '0400 000 000' }))
        .statusCode,
    ).toBe(403);
    const edited = await pm.browser.patch(`${base}/members/${subMember.id}`, {
      phone: '0400 111 222',
      jobTitle: 'Site foreman',
      trade: 'Electrical',
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ jobTitle: 'Site foreman', trade: 'Electrical' });
    expect(await list('?q=0400%20111')).toHaveLength(1);
    expect(await list('?q=sparky')).toHaveLength(1);
    expect(await list('?trade=electrical')).toHaveLength(1);
    expect(await list('?trade=plumbing')).toHaveLength(0);
    expect(await list('?q=nobody-by-this-name')).toHaveLength(0);
    expect(await list(`?companyId=${subMember.companyId}`)).toHaveLength(1);
    const cleared = await pm.browser.patch(`${base}/members/${subMember.id}`, { phone: '' });
    expect(cleared.json().phone).toBeNull();
    expect(cleared.json().jobTitle).toBe('Site foreman');
  });

  it('creates, searches, edits and deletes company contacts, scoped to the org', async () => {
    const pm = await signUp(t.app, 'cc-pm');
    const other = await signUp(t.app, 'cc-other');
    const org = await createOrg(pm.browser, 'Contacts Builder');
    const otherOrg = await createOrg(other.browser, 'Other Builder');
    const base = `/v1/orgs/${org.id}`;
    const company = (
      await pm.browser.post(`${base}/companies`, { name: 'Acme Supplies', type: 'supplier' })
    ).json() as { id: string };

    const bad = await pm.browser.post(`${base}/company-contacts`, {
      companyId: 'cmp_00000000000000000000000000',
      name: 'Nobody',
    });
    expect(bad.json().code).toBe('company.not_found');

    const created = await pm.browser.post(`${base}/company-contacts`, {
      companyId: company.id,
      name: 'Dana Orders',
      phone: '02 9000 0000',
      jobTitle: 'Office',
    });
    expect(created.statusCode).toBe(201);
    const contact = created.json() as { id: string; email: string | null };
    expect(contact.email).toBeNull();

    const search = async (qs: string) =>
      (await pm.browser.get(`${base}/company-contacts${qs}`)).json().data as unknown[];
    expect(await search('')).toHaveLength(1);
    expect(await search('?q=9000')).toHaveLength(1);
    expect(await search('?q=zzz')).toHaveLength(0);
    expect(await search(`?companyId=${company.id}`)).toHaveLength(1);

    const patched = await pm.browser.patch(`${base}/company-contacts/${contact.id}`, {
      email: 'dana@acme.example',
      jobTitle: null,
    });
    expect(patched.json()).toMatchObject({
      email: 'dana@acme.example',
      jobTitle: null,
      version: 2,
    });

    // Another org cannot see or change it.
    expect(
      (await other.browser.get(`/v1/orgs/${otherOrg.id}/company-contacts`)).json().data,
    ).toHaveLength(0);
    expect(
      (
        await other.browser.patch(`/v1/orgs/${otherOrg.id}/company-contacts/${contact.id}`, {
          name: 'x',
        })
      ).statusCode,
    ).toBe(404);

    expect((await pm.browser.del(`${base}/company-contacts/${contact.id}`)).statusCode).toBe(204);
    expect(await search('')).toHaveLength(0);
    expect((await pm.browser.del(`${base}/company-contacts/${contact.id}`)).statusCode).toBe(404);
  });
});
