import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const swmsContent = {
  hazardsAndRisks: 'Falls from the level 3 slab edge.\nDropped tools onto people below.',
  controlMeasures: [{ level: 'engineer', description: 'Edge protection to AS 4687' }],
  implementation: 'Supervisor inspects each morning; reviewed after any change to the edge.',
  siteSpecific: 'Level 3 slab, crane on the north side, tilers working below.',
};

async function setup() {
  const pm = await signUp(t.app, 'ptp-pm');
  const sub = await signUp(t.app, 'ptp-sub');
  const other = await signUp(t.app, 'ptp-other');
  const org = await createOrg(pm.browser, 'Pre-task Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Plan Co',
  );
  await addMember(pm.browser, org.id, project.id, other.email, 'Subcontractor', 'Other Co');
  const sig = (bytes: Buffer, name: string) =>
    uploadBytes(t, pm.browser, org.id, project.id, bytes, name, 'image/png', 'safety');
  return { pm, sub, other, org, project, base, subCo, sig };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const today = () => new Date().toISOString().slice(0, 10);
const hazard = (over: Record<string, unknown> = {}) => ({
  hazard: 'Falls from the slab edge',
  riskBefore: 'high',
  controls: 'Edge protection checked before starting',
  riskAfter: 'low',
  ...over,
});

describe('Pre-task plans', () => {
  it('runs a plan: hazards, sign-on, close, supervisor review, trail, reopen', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/pretask-plans`, {
      taskTitle: 'Install edge protection, level 3',
      workDate: today(),
      supervisorName: 'Pat Foreman',
      location: 'Level 3',
      hazards: [hazard()],
      crew: [{ personName: 'Sam Carpenter' }, { personName: 'Lee Rigger' }],
    });
    expect(created.statusCode).toBe(201);
    let d = created.json();
    expect(d.plan).toMatchObject({ numberLabel: 'PTP-0001', status: 'open', crewCount: 2 });
    expect(d.closeBlockers[0]).toMatch(/2 people have not signed/);

    const dup = await s.pm.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/crew`,
      { crew: [{ personName: 'sam carpenter' }] },
      { 'if-match': etagOf(created) },
    );
    expect(dup.json().code).toBe('pretask.already_listed');

    const early = await s.pm.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(created) },
    );
    expect(early.json().code).toBe('pretask.cannot_close');

    let version = etagOf(created);
    const sigA = await s.sig(PNG_A, 'sig-a.png');
    const sigB = await s.sig(PNG_B, 'sig-b.png');
    for (const [i, c] of (d.crew as { id: string }[]).entries()) {
      const r = await s.pm.browser.put(
        `${s.base}/pretask-plans/${d.plan.id}/crew/${c.id}/signature`,
        { signatureFileId: i === 0 ? sigA : sigB },
        { 'if-match': version },
      );
      expect(r.statusCode).toBe(200);
      version = etagOf(r);
      d = r.json();
    }
    expect(d.closeBlockers).toEqual([]);

    // Hazards cannot change under people who have already signed.
    const locked = await s.pm.browser.patch(
      `${s.base}/pretask-plans/${d.plan.id}`,
      { hazards: [hazard({ hazard: 'Something else' })] },
      { 'if-match': version },
    );
    expect(locked.json().code).toBe('pretask.has_signatures');

    const closed = await s.pm.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/transition`,
      { action: 'close' },
      { 'if-match': version },
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().plan.status).toBe('closed');
    const frozen = await s.pm.browser.patch(
      `${s.base}/pretask-plans/${d.plan.id}`,
      { location: 'Level 4' },
      { 'if-match': etagOf(closed) },
    );
    expect(frozen.json().code).toBe('pretask.closed');

    // Closed and unreviewed shows in the supervisor's queue; reviewing takes it out.
    const queue = (await s.pm.browser.get(`${s.base}/pretask-plans?unreviewed=true`)).json().data;
    expect(queue.map((p: { id: string }) => p.id)).toEqual([d.plan.id]);
    const reviewed = await s.pm.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/review`,
      { note: 'Edge rails checked on site.' },
      { 'if-match': etagOf(closed) },
    );
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().plan.reviewNote).toBe('Edge rails checked on site.');
    expect((await s.pm.browser.get(`${s.base}/pretask-plans?unreviewed=true`)).json().data).toEqual(
      [],
    );
    expect(reviewed.json().events.map((e: { action: string }) => e.action)).toEqual([
      'created',
      'signed',
      'signed',
      'closed',
      'reviewed',
    ]);

    const reopened = await s.pm.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/transition`,
      { action: 'reopen' },
      { 'if-match': etagOf(reviewed) },
    );
    expect(reopened.json().plan).toMatchObject({ status: 'open', reviewedAt: null });
  });

  it('will not close with extreme risk left or hazards without controls', async () => {
    const s = await setup();
    const c = await s.pm.browser.post(`${s.base}/pretask-plans`, {
      taskTitle: 'Trench shoring',
      workDate: today(),
      supervisorName: 'Pat Foreman',
      hazards: [
        hazard({ hazard: 'Trench collapse', riskAfter: 'extreme' }),
        hazard({ hazard: 'Noise', controls: '' }),
      ],
      crew: [{ personName: 'Sam Carpenter' }],
    });
    const d = c.json();
    const blockers: string[] = d.closeBlockers;
    expect(blockers.some((b) => /Do not start/.test(b))).toBe(true);
    expect(blockers.some((b) => /control "Noise"/.test(b))).toBe(true);
  });

  it('links a SWMS, warns when crew have not read it, and keeps the record to the right people', async () => {
    const s = await setup();
    const sent = await s.sub.browser.post(`${s.base}/swms`, {
      title: 'Edge protection install',
      highRiskWorkCategories: ['fall_2m'],
      content: swmsContent,
    });
    const w = sent.json();
    const accepted = await s.pm.browser.post(
      `${s.base}/swms/${w.swms.id}/transition`,
      { action: 'accept', confirmedUnderstandable: true },
      { 'if-match': etagOf(sent) },
    );
    expect(accepted.statusCode).toBe(200);

    const created = await s.sub.browser.post(`${s.base}/pretask-plans`, {
      taskTitle: 'Edge protection',
      workDate: today(),
      supervisorName: 'Sub Foreman',
      swmsId: w.swms.id,
      companyId: s.subCo.companyId,
      hazards: [hazard()],
      crew: [{ personName: 'Sam Scaffolder', userId: s.sub.userId, companyId: s.subCo.companyId }],
    });
    expect(created.statusCode).toBe(201);
    const d = created.json();
    expect(d.swms).toMatchObject({ numberLabel: 'SWMS-0001', status: 'accepted' });
    expect(d.warnings.map((x: { code: string }) => x.code)).toEqual(['swms_not_read']);

    // Signing notes the induction status (unknown: no induction register entry for this person).
    const signed = await s.sub.browser.put(
      `${s.base}/pretask-plans/${d.plan.id}/crew/${d.crew[0].id}/signature`,
      { signatureFileId: await s.sig(PNG_A, 'sub-sig.png') },
      { 'if-match': etagOf(created) },
    );
    expect(signed.statusCode).toBe(200);
    expect(signed.json().crew[0].inductionStatus).toBe('unknown');

    // Reading the SWMS clears the warning.
    await s.sub.browser.post(`${s.base}/swms/${w.swms.id}/acknowledge`, {
      workerName: 'Sam Scaffolder',
    });
    const after = await s.sub.browser.get(`${s.base}/pretask-plans/${d.plan.id}`);
    expect(after.json().warnings).toEqual([]);

    // Another subcontractor sees nothing; the starter can't review or reopen.
    expect((await s.other.browser.get(`${s.base}/pretask-plans/${d.plan.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.other.browser.get(`${s.base}/pretask-plans`)).json().data).toEqual([]);
    const closed = await s.sub.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(signed) },
    );
    expect(closed.statusCode).toBe(200);
    const noReview = await s.sub.browser.post(
      `${s.base}/pretask-plans/${d.plan.id}/review`,
      {},
      { 'if-match': etagOf(closed) },
    );
    expect(noReview.statusCode).toBe(403);
  });

  it('suggests hazards that keep recurring, from the SWMS and from recent incidents', async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++)
      await s.pm.browser.post(`${s.base}/pretask-plans`, {
        taskTitle: `Formwork day ${i}`,
        workDate: today(),
        supervisorName: 'Pat',
        hazards: [hazard({ hazard: 'Wet slippery ground', controls: 'Matting laid' })],
        crew: [{ personName: 'Sam' }],
      });
    await s.pm.browser.post(`${s.base}/incidents`, {
      title: 'Near miss at hoist',
      type: 'near_miss',
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const sent = await s.sub.browser.post(`${s.base}/swms`, {
      title: 'Edge protection',
      highRiskWorkCategories: ['fall_2m'],
      content: swmsContent,
    });
    const out = (
      await s.pm.browser.get(`${s.base}/pretask-plans/suggestions?swmsId=${sent.json().swms.id}`)
    ).json().data;
    expect(out.map((x: { reason: string }) => x.reason)).toEqual([
      'recurring',
      'from_swms',
      'from_swms',
      'recent_incident',
    ]);
    expect(out[0]).toMatchObject({ hazard: 'Wet slippery ground', controls: 'Matting laid' });
    expect(out[0].because).toMatch(/2 plans/);
    // Incident-based prompts are for builder staff only.
    const forSub = (await s.sub.browser.get(`${s.base}/pretask-plans/suggestions`)).json().data;
    expect(forSub.some((x: { reason: string }) => x.reason === 'recent_incident')).toBe(false);
  });
});
