import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** A 1 x 1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Nova: ask about this view (site capture)', () => {
  it('reads an uploaded still, keeps open observations, and lets a person decide each once', async () => {
    const pm = await signUp(t.app, 'cap-pm');
    const org = await createOrg(pm.browser, 'Capture Builders');
    const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const fileId = await uploadBytes(
      t,
      pm.browser,
      org.id,
      project.id,
      PNG,
      'view.png',
      'image/png',
    );

    const res = await pm.browser.post(`${base}/ai/captures/view-scans`, {
      still: { fileId },
      note: 'Level 3 riser, pipe penetration through the wall with no fire-stopping',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scanId).toMatch(/^acs_/);
    expect(body.disclaimer).toContain('not the live 360 tour');
    expect(body.observations.map((o: { category: string }) => o.category).sort()).toEqual([
      'fire_stopping',
      'services',
    ]);
    for (const o of body.observations) {
      expect(o).toMatchObject({ status: 'open', fileId });
      expect(o.id).toMatch(/^aco_/);
    }
    expect(t.ai.calls.at(-1)!.task).toBe('coordination.capture_scan');

    const id = body.observations[0].id as string;
    const review = (obsId: string, decision: string) =>
      pm.browser.post(`${base}/ai/captures/observations/${obsId}/review`, {
        decision,
        note: 'Seen',
      });
    expect((await review(id, 'confirmed')).json()).toMatchObject({ status: 'confirmed' });
    const again = await review(id, 'dismissed');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ai.capture_observation.already_reviewed');
    expect((await review(`aco_${'0'.repeat(26)}`, 'confirmed')).statusCode).toBe(404);

    const open = (await pm.browser.get(`${base}/ai/captures/observations?status=open`)).json();
    expect(open.data).toHaveLength(1);
    const forFile = (
      await pm.browser.get(`${base}/ai/captures/observations?fileId=${fileId}`)
    ).json();
    expect(forFile.data).toHaveLength(2);
  });
});
