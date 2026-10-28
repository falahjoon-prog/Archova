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

describe('mobile pull: documents', () => {
  it('sends folders and documents, and hides private folders from people not allowed in', async () => {
    const owner = await signUp(t.app, 'syd2-owner');
    const sub = await signUp(t.app, 'syd2-sub');
    const org = await createOrg(owner.browser, 'Docs Sync Builder');
    const project = await createProject(owner.browser, org.id, { name: 'Tower C', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(owner.browser, org.id, project.id, sub.email, 'Subcontractor');
    const open = (await owner.browser.post(`${base}/folders`, { name: 'Reports' })).json();
    const legal = (
      await owner.browser.post(`${base}/folders`, { name: 'Contracts', isPrivate: true })
    ).json();
    const doc = async (folderId: string, title: string) => {
      const fileId = await uploadFile(t, owner.browser, org.id, project.id, `${title}.pdf`);
      const res = await owner.browser.post(`${base}/documents`, {
        folderId,
        title,
        revision: { rev: '0', fileId },
      });
      expect(res.statusCode).toBe(201);
      return res.json().document.id as string;
    };
    const openDoc = await doc(open.id, 'Site report');
    const secretDoc = await doc(legal.id, 'Head contract');

    const pull = async (who: typeof owner) =>
      (
        await who.browser.get(
          `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(`project:${project.id}:documents`)}&since=0`,
        )
      ).json() as { changes: Array<{ id: string; op: string; version: number }> };
    const summary = (p: Awaited<ReturnType<typeof pull>>) =>
      Object.fromEntries(p.changes.map((c) => [c.id, `${c.op}:${c.version > 0 ? 'v' : '0'}`]));

    const full = summary(await pull(owner));
    expect(full).toMatchObject({
      [open.id]: 'upsert:v',
      [legal.id]: 'upsert:v',
      [openDoc]: 'upsert:v',
      [secretDoc]: 'upsert:v',
    });
    expect(summary(await pull(sub))).toMatchObject({
      [open.id]: 'upsert:v',
      [openDoc]: 'upsert:v',
      [legal.id]: 'delete:0',
      [secretDoc]: 'delete:0',
    });
  });
});
