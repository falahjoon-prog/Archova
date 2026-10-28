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

describe('mobile pull: RFIs', () => {
  it('sends a draft to its author only, and a sent RFI to the people it reached', async () => {
    const pm = await signUp(t.app, 'syr-pm');
    const eng = await signUp(t.app, 'syr-eng');
    const sub = await signUp(t.app, 'syr-sub');
    const org = await createOrg(pm.browser, 'Rfi Sync Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Quay', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Fire Eng Co');
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Plumbco');

    const sent = await pm.browser.post(`${base}/rfis`, {
      subject: 'Riser wall rating',
      question: 'Confirm FRL at riser.',
      assigneeIds: [eng.userId],
    });
    expect(sent.statusCode).toBe(201);
    const sentId = sent.json().rfi.id as string;
    const opened = await pm.browser.post(`${base}/rfis/${sentId}/open`, undefined, {
      'if-match': sent.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
    const draft = await pm.browser.post(`${base}/rfis`, {
      subject: 'Draft only',
      question: 'Not sent yet.',
      assigneeIds: [eng.userId],
    });
    const draftId = draft.json().rfi.id as string;

    const pull = async (who: typeof pm) =>
      (
        await who.browser.get(
          `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(`project:${project.id}:rfis`)}&since=0`,
        )
      ).json() as {
        changes: Array<{ entityType: string; id: string; op: string; version: number }>;
      };
    const summary = (p: Awaited<ReturnType<typeof pull>>) =>
      Object.fromEntries(p.changes.map((c) => [c.id, `${c.op}:${c.version > 0 ? 'v' : '0'}`]));

    const author = summary(await pull(pm));
    expect(author[sentId]).toBe('upsert:v');
    expect(author[draftId]).toBe('upsert:v');

    const consultant = summary(await pull(eng));
    expect(consultant[sentId]).toBe('upsert:v');
    expect(consultant[draftId]).toBe('delete:0');

    const stranger = summary(await pull(sub));
    expect(stranger[sentId]).toBe('delete:0');
    expect(stranger[draftId]).toBe('delete:0');
  });
});
