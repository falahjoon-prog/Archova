import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FAKE_RESPONDERS } from '@archova/mod-ai';
import {
  addMember,
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

async function setup() {
  const pm = await signUp(t.app, 'hz-pm');
  const org = await createOrg(pm.browser, 'Hazard Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const photo = () => uploadBytes(t, pm.browser, org.id, project.id, PNG, 'site.png', 'image/png');
  const scan = (note: string, fileId: string) =>
    pm.browser.post(`${base}/ai/safety/photo-scans`, { photo: { fileId }, note });
  return { pm, org, project, base, photo, scan };
}

describe('Nova site photo hazard signals (F35)', () => {
  it('flags what the photo shows as open signals for a manager, never as findings', async () => {
    const s = await setup();
    const fileId = await s.photo();
    const res = await s.scan(
      'Slab edge on level 3 with no balustrade, rubbish in the corridor',
      fileId,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scanId).toMatch(/^ahn_/);
    expect(body.runId).toMatch(/^air_/);
    expect(body.disclaimer).toContain('not a safety inspection');
    expect(body.signals.map((x: { category: string }) => x.category).sort()).toEqual([
      'edge_protection',
      'housekeeping',
    ]);
    for (const sig of body.signals) {
      expect(sig).toMatchObject({ status: 'open', fileId, reviewedAt: null });
      expect(sig.id).toMatch(/^ahs_/);
    }
    // The model got the photo.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('safety.hazard_scan');
    expect(call.images).toEqual([{ mime: 'image/png', base64: PNG.toString('base64') }]);

    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    const row = usage.byFeature.find((f: { feature: string }) => f.feature === 'safety_hazards');
    expect(row.runs).toBe(1);
    expect(row.credits).toBeCloseTo(0.25, 5);

    const listed = (
      await s.pm.browser.get(`${s.base}/ai/safety/hazard-signals?status=open`)
    ).json();
    expect(listed.data).toHaveLength(2);
  });

  it('drops wording that judges and saves nothing when the photo shows nothing', async () => {
    const s = await setup();
    const fileId = await s.photo();
    t.ai.on('safety.hazard_scan', () => ({
      output: {
        signals: [
          {
            category: 'ppe',
            observation: 'The contractor is in breach of the WHS Act.',
            confidence: 'high',
          },
          {
            category: 'ppe',
            observation: 'One worker is not wearing a hard hat.',
            confidence: 'medium',
          },
        ],
        photoUnclear: false,
      },
    }));
    try {
      const body = (await s.scan('', fileId)).json();
      expect(body.dropped).toBe(1);
      expect(body.signals).toHaveLength(1);
      expect(body.signals[0].observation).toBe('One worker appears not to be wearing a hard hat.');
    } finally {
      t.ai.on('safety.hazard_scan', DEFAULT_FAKE_RESPONDERS['safety.hazard_scan']!);
    }
    const clean = (await s.scan('Finished lobby floor', await s.photo())).json();
    expect(clean.signals).toEqual([]);
  });

  it('lets a manager confirm or dismiss each signal once, and shows repeated hazards as a pattern', async () => {
    const s = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const body = (await s.scan('Crew with no hard hats', await s.photo())).json();
      ids.push(body.signals[0].id);
    }
    const dismissedScan = (await s.scan('Crew with no hard hats', await s.photo())).json();

    const review = (id: string, decision: string, note?: string) =>
      s.pm.browser.post(`${s.base}/ai/safety/hazard-signals/${id}/review`, { decision, note });
    for (const id of ids) {
      const ok = await review(id, 'confirmed', 'Seen on site');
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ status: 'confirmed', reviewNote: 'Seen on site' });
    }
    expect((await review(dismissedScan.signals[0].id, 'dismissed')).statusCode).toBe(200);
    const again = await review(ids[0]!, 'dismissed');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ai.hazard_signal.already_reviewed');
    expect((await review(`ahs_${'0'.repeat(26)}`, 'confirmed')).statusCode).toBe(404);

    const patterns = (await s.pm.browser.get(`${s.base}/ai/safety/hazard-patterns?days=30`)).json();
    expect(patterns.days).toBe(30);
    expect(patterns.data[0]).toMatchObject({
      category: 'ppe',
      confirmed: 3,
      dismissed: 1,
      open: 0,
      photos: 3,
      isPattern: true,
    });
  });

  it('only reads photos of this project, and only for people who may scan and review', async () => {
    const s = await setup();
    const notImage = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      Buffer.from('%PDF-1.4'),
      'spec.pdf',
      'application/pdf',
    );
    expect((await s.scan('', notImage)).statusCode).toBe(422);
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Elsewhere', state: 'VIC' });
    const elsewhere = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      other.id,
      PNG,
      'x.png',
      'image/png',
    );
    expect((await s.scan('', elsewhere)).statusCode).toBe(422);
    const missing = await s.scan('', `fil_${'0'.repeat(26)}`);
    expect(missing.statusCode).toBe(404);

    const stranger = await signUp(t.app, 'hz-stranger');
    const fileId = await s.photo();
    const denied = await stranger.browser.post(`${s.base}/ai/safety/photo-scans`, {
      photo: { fileId },
    });
    expect([403, 404]).toContain(denied.statusCode);
    expect([403, 404]).toContain(
      (await stranger.browser.get(`${s.base}/ai/safety/hazard-signals`)).statusCode,
    );
    expect([403, 404]).toContain(
      (await stranger.browser.get(`${s.base}/ai/safety/hazard-patterns`)).statusCode,
    );

    // Someone who can report an incident can scan a photo but can't review the signals or read the patterns.
    const worker = await signUp(t.app, 'hz-worker');
    await addMember(s.pm.browser, s.org.id, s.project.id, worker.email, 'Subcontractor', 'Sparks');
    const mine = await worker.browser.post(`${s.base}/ai/safety/photo-scans`, {
      photo: { fileId },
      note: 'Rubbish in the stairwell',
    });
    expect(mine.statusCode).toBe(200);
    expect((await worker.browser.get(`${s.base}/ai/safety/hazard-signals`)).statusCode).toBe(403);
    expect((await worker.browser.get(`${s.base}/ai/safety/hazard-patterns`)).statusCode).toBe(403);
  });
});
