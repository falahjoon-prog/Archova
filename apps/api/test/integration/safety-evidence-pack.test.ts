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

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Safety evidence pack', () => {
  it('bundles the project safety records for the dates, flags gaps, and is for safety managers only', async () => {
    const pm = await signUp(t.app, 'evp-pm');
    const sub = await signUp(t.app, 'evp-sub');
    const org = await createOrg(pm.browser, 'Evidence Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower E', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Evidence Co');

    const reported = await pm.browser.post(`${base}/incidents`, {
      title: 'Scaffold plank slipped',
      type: 'dangerous_occurrence',
      occurredAt: new Date().toISOString(),
      severity: 'high',
      isNotifiable: true,
      notifiableClass: 'dangerous_incident',
    });
    expect(reported.statusCode).toBe(201);

    const query = `from=${day(-7)}&to=${day(1)}`;
    const res = await pm.browser.get(`${base}/safety-evidence-pack?${query}`);
    expect(res.statusCode).toBe(200);
    const pack = res.json();
    expect(pack.incidents.rows).toHaveLength(1);
    expect(pack.incidents.rows[0]).toMatchObject({ ref: 'INC-0001', isNotifiable: true });
    // Nova's pre-check: notifiable with no regulator time recorded is the worst gap.
    expect(pack.gaps[0]).toMatchObject({ section: 'incidents', severity: 'high' });
    expect(pack.gaps[0].message).toContain('INC-0001');
    expect(pack.pretasks.restricted).toBe(false);

    const pdf = await pm.browser.get(`${base}/safety-evidence-pack/pdf?${query}`);
    expect(pdf.statusCode).toBe(200);
    expect(Buffer.from(pdf.json().dataBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');

    const empty = await pm.browser.get(
      `${base}/safety-evidence-pack?from=${day(-400)}&to=${day(-380)}`,
    );
    expect(empty.json().gaps[0]).toMatchObject({ section: 'pack', severity: 'high' });

    expect(
      (await pm.browser.get(`${base}/safety-evidence-pack?from=${day(1)}&to=${day(-1)}`))
        .statusCode,
    ).toBe(422);
    expect((await sub.browser.get(`${base}/safety-evidence-pack?${query}`)).statusCode).toBe(403);
  });
});
