import { encodeId, uuidv7 } from '@archova/domain';
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

async function setup() {
  const pm = await signUp(t.app, 'qs-pm');
  const sub = await signUp(t.app, 'qs-sub');
  const other = await signUp(t.app, 'qs-other');
  const org = await createOrg(pm.browser, 'Quality Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower Q', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Scaffold Co',
  );
  const otherCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    other.email,
    'Subcontractor',
    'Tilers R Us',
  );
  return { pm, sub, other, org, project, base, subCo, otherCo };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('Inspections (quality-safety schema)', () => {
  it('builds a checklist, freezes it, inspects, and submits only when complete', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/inspection-templates`, {
      name: 'Pre-pour check',
      type: 'pre-pour',
      items: [
        {
          section: 'Formwork',
          prompt: 'Formwork is braced',
          responseType: 'pass_fail_na',
          createsDefectOnFail: true,
        },
        { section: 'Formwork', prompt: 'Cover to reo (mm)', responseType: 'number' },
        {
          section: 'Sign-off',
          prompt: 'Slump class',
          responseType: 'select',
          options: ['S80', 'S100'],
          required: false,
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const tpl = created.json().template;
    const items = created.json().items as Array<{ id: string; prompt: string }>;
    expect(tpl).toMatchObject({ published: false, version: 1 });

    // A draft can't be used, and it can be edited; once published it is frozen.
    const early = await s.pm.browser.post(`${s.base}/inspections`, { templateId: tpl.id });
    expect(early.json().code).toBe('inspection_template.not_published');
    const edited = await s.pm.browser.put(`${s.base}/inspection-templates/${tpl.id}`, {
      name: 'Pre-pour check v1',
    });
    expect(edited.statusCode).toBe(200);
    expect(
      (await s.pm.browser.post(`${s.base}/inspection-templates/${tpl.id}/publish`)).statusCode,
    ).toBe(200);
    const frozen = await s.pm.browser.put(`${s.base}/inspection-templates/${tpl.id}`, {
      name: 'Changed',
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().code).toBe('inspection_template.published');

    const started = await s.pm.browser.post(`${s.base}/inspections`, {
      templateId: tpl.id,
      location: 'Level 3 slab',
    });
    expect(started.statusCode).toBe(201);
    const ins = started.json().inspection;
    expect(ins).toMatchObject({
      numberLabel: 'INS-0001',
      status: 'scheduled',
      templateVersion: 1,
      title: 'Pre-pour check v1',
    });
    expect(started.json().missingRequiredItemIds).toHaveLength(2);

    // A new version leaves the inspection on the version it started with.
    const v2 = await s.pm.browser.post(`${s.base}/inspection-templates/${tpl.id}/versions`);
    expect(v2.statusCode).toBe(201);
    expect(v2.json().template).toMatchObject({ version: 2, published: false });

    const bad = await s.pm.browser.put(`${s.base}/inspections/${ins.id}/responses`, {
      responses: [{ templateItemId: items[1]!.id, value: 'thick' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('inspection.invalid_response');

    const half = await s.pm.browser.put(`${s.base}/inspections/${ins.id}/responses`, {
      responses: [
        { templateItemId: items[0]!.id, result: 'fail', note: 'Brace missing at grid C' },
      ],
    });
    expect(half.statusCode).toBe(200);
    expect(half.json().inspection.status).toBe('in_progress');
    expect(half.json().failedItemIds).toEqual([items[0]!.id]);

    const early2 = await s.pm.browser.post(
      `${s.base}/inspections/${ins.id}/submit`,
      { signedByName: 'Pat Manager' },
      { 'if-match': etagOf(half) },
    );
    expect(early2.statusCode).toBe(422);
    expect(early2.json().code).toBe('inspection.incomplete');

    const full = await s.pm.browser.put(`${s.base}/inspections/${ins.id}/responses`, {
      responses: [{ templateItemId: items[1]!.id, value: 40 }],
    });
    const submitted = await s.pm.browser.post(
      `${s.base}/inspections/${ins.id}/submit`,
      { signedByName: 'Pat Manager' },
      { 'if-match': etagOf(full) },
    );
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().inspection).toMatchObject({
      status: 'submitted',
      signedBy: { name: 'Pat Manager' },
    });
    const locked = await s.pm.browser.put(`${s.base}/inspections/${ins.id}/responses`, {
      responses: [{ templateItemId: items[1]!.id, value: 41 }],
    });
    expect(locked.json().code).toBe('inspection.invalid_state');
    const closed = await s.pm.browser.post(
      `${s.base}/inspections/${ins.id}/close`,
      {},
      { 'if-match': etagOf(submitted) },
    );
    expect(closed.json().inspection.status).toBe('closed');

    // Subcontractors don't see the builder's checklists or inspections.
    expect((await s.sub.browser.get(`${s.base}/inspections`)).statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/inspection-templates`)).statusCode).toBe(404);
  });
});

describe('Observations', () => {
  it('is raised, resolved by the assigned company, closed by the builder, and hidden from others', async () => {
    const s = await setup();
    const raised = await s.pm.browser.post(`${s.base}/observations`, {
      type: 'safety',
      hazard: 'Unprotected edge',
      description: 'No edge protection at level 3 north.',
      priority: 'high',
      assigneeCompanyId: s.subCo.companyId,
      dueDate: '2030-01-15',
    });
    expect(raised.statusCode).toBe(201);
    const o = raised.json();
    expect(o).toMatchObject({
      numberLabel: 'OBS-0001',
      status: 'open',
      availableActions: ['resolve', 'close', 'stopWork'],
    });

    expect(
      (await s.sub.browser.get(`${s.base}/observations/${o.id}`)).json().availableActions,
    ).toEqual(['resolve', 'stopWork']);
    expect((await s.other.browser.get(`${s.base}/observations/${o.id}`)).statusCode).toBe(404);
    expect((await s.other.browser.get(`${s.base}/observations`)).json().data).toEqual([]);

    const resolved = await s.sub.browser.post(
      `${s.base}/observations/${o.id}/transition`,
      { action: 'resolve', reason: 'Edge protection installed' },
      { 'if-match': etagOf(raised) },
    );
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Edge protection installed',
      availableActions: [],
    });

    const subClose = await s.sub.browser.post(
      `${s.base}/observations/${o.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(resolved) },
    );
    expect(subClose.statusCode).toBe(403);
    const noReason = await s.pm.browser.post(
      `${s.base}/observations/${o.id}/transition`,
      { action: 'reopen' },
      { 'if-match': etagOf(resolved) },
    );
    expect(noReason.json().code).toBe('observation.reason_required');
    const closed = await s.pm.browser.post(
      `${s.base}/observations/${o.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(resolved) },
    );
    expect(closed.json()).toMatchObject({ status: 'closed' });
    const edit = await s.pm.browser.patch(
      `${s.base}/observations/${o.id}`,
      { priority: 'low' },
      { 'if-match': etagOf(closed) },
    );
    expect(edit.json().code).toBe('observation.invalid_transition');
  });

  it("refuses an assignee that isn't on the project", async () => {
    const s = await setup();
    const res = await s.pm.browser.post(`${s.base}/observations`, {
      type: 'quality',
      description: 'Render cracking',
      assigneeCompanyId: encodeId('company', uuidv7()),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('observation.assignee_not_on_project');
  });
});

describe('SWMS register', () => {
  const content = {
    hazardsAndRisks: 'Falls from the level 3 slab edge.',
    controlMeasures: [{ level: 'engineer', description: 'Edge protection to AS 4687' }],
    implementation: 'Supervisor inspects each morning; reviewed after any change to the edge.',
    siteSpecific: 'Level 3 slab, crane on the north side, tilers working below.',
  };

  it('submits, is checked, accepted only when complete, acknowledged, and reopened by stop work', async () => {
    const s = await setup();
    const sent = await s.sub.browser.post(`${s.base}/swms`, {
      title: 'Edge protection install',
      highRiskWorkCategories: ['fall_2m'],
    });
    expect(sent.statusCode).toBe(201);
    const w = sent.json();
    expect(w.swms).toMatchObject({
      numberLabel: 'SWMS-0001',
      status: 'submitted',
      revision: 1,
      companyId: s.subCo.companyId,
    });
    expect(w.gaps.map((g: { item: number }) => g.item)).toEqual([2, 3, 4, 5]);
    expect(w.availableActions).toEqual([]);

    // Another subcontractor can't see it; the builder can.
    expect((await s.other.browser.get(`${s.base}/swms/${w.swms.id}`)).statusCode).toBe(404);
    const asPm = await s.pm.browser.get(`${s.base}/swms/${w.swms.id}`);
    expect(asPm.json().availableActions).toEqual(['markReviewed', 'accept', 'reject']);

    // A subcontractor can't review; the builder can't accept an incomplete SWMS.
    expect(
      (
        await s.sub.browser.post(
          `${s.base}/swms/${w.swms.id}/transition`,
          { action: 'accept', confirmedUnderstandable: true },
          { 'if-match': etagOf(sent) },
        )
      ).statusCode,
    ).toBe(403);
    const refused = await s.pm.browser.post(
      `${s.base}/swms/${w.swms.id}/transition`,
      { action: 'accept', confirmedUnderstandable: true },
      { 'if-match': etagOf(sent) },
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('swms.incomplete');

    // Revising starts revision 2.
    const revised = await s.sub.browser.patch(
      `${s.base}/swms/${w.swms.id}`,
      { content },
      { 'if-match': etagOf(sent) },
    );
    expect(revised.statusCode).toBe(200);
    expect(revised.json().swms.revision).toBe(2);
    expect(revised.json().gaps).toEqual([]);
    const check = await s.pm.browser.get(`${s.base}/swms/${w.swms.id}/check`);
    expect(check.json()).toEqual({ gaps: [], advisories: [] });

    const unconfirmed = await s.pm.browser.post(
      `${s.base}/swms/${w.swms.id}/transition`,
      { action: 'accept' },
      { 'if-match': etagOf(revised) },
    );
    expect(unconfirmed.json().code).toBe('swms.incomplete');
    const accepted = await s.pm.browser.post(
      `${s.base}/swms/${w.swms.id}/transition`,
      { action: 'accept', confirmedUnderstandable: true },
      { 'if-match': etagOf(revised) },
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().swms.status).toBe('accepted');

    const acked = await s.sub.browser.post(`${s.base}/swms/${w.swms.id}/acknowledge`, {
      workerName: 'Sam Scaffolder',
    });
    expect(acked.json().acknowledgements).toHaveLength(1);
    expect(
      (
        await s.sub.browser.post(`${s.base}/swms/${w.swms.id}/acknowledge`, {
          workerName: 'Sam Scaffolder',
        })
      ).json().acknowledgements,
    ).toHaveLength(1);

    // Stop work: a safety observation that the SWMS isn't followed sends it back for review.
    const obs = await s.pm.browser.post(`${s.base}/observations`, {
      type: 'safety',
      description: 'Edge protection removed while working.',
      assigneeCompanyId: s.subCo.companyId,
      swmsId: w.swms.id,
    });
    const stopped = await s.pm.browser.post(
      `${s.base}/observations/${obs.json().id}/transition`,
      { action: 'stopWork', reason: 'Work stopped, edge protection removed' },
      { 'if-match': etagOf(obs) },
    );
    expect(stopped.statusCode).toBe(200);
    const after = await s.pm.browser.get(`${s.base}/swms/${w.swms.id}`);
    expect(after.json().swms).toMatchObject({ status: 'submitted', revision: 3 });
    expect(after.json().acknowledgements).toEqual([]);
    expect(after.json().events.map((e: { action: string }) => e.action)).toEqual([
      'submit',
      'revise',
      'accept',
      'stop_work',
    ]);
  });

  it('rejects with a reason and lists the register by status', async () => {
    const s = await setup();
    const sent = await s.sub.browser.post(`${s.base}/swms`, {
      title: 'Hot work',
      highRiskWorkCategories: ['energised_electrical'],
      content,
    });
    const noReason = await s.pm.browser.post(
      `${s.base}/swms/${sent.json().swms.id}/transition`,
      { action: 'reject' },
      { 'if-match': etagOf(sent) },
    );
    expect(noReason.json().code).toBe('swms.reason_required');
    const rejected = await s.pm.browser.post(
      `${s.base}/swms/${sent.json().swms.id}/transition`,
      { action: 'reject', reason: 'Not specific to this site' },
      { 'if-match': etagOf(sent) },
    );
    expect(rejected.json().swms.status).toBe('rejected');
    const list = await s.pm.browser.get(`${s.base}/swms?status=rejected`);
    expect(list.json().data).toHaveLength(1);
    expect((await s.pm.browser.get(`${s.base}/swms?status=accepted`)).json().data).toEqual([]);
  });
});

describe('DBP Act insights', () => {
  it('rolls a checklist result and a classified observation up by building element', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/inspection-templates`, {
      name: 'Fire stopping',
      tradeCategory: 'fire_safety',
      items: [{ prompt: 'Penetrations sealed', responseType: 'pass_fail_na' }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().template.tradeCategory).toBe('fire_safety');
    const tpl = created.json().template;
    const item = created.json().items[0] as { id: string };
    await s.pm.browser.post(`${s.base}/inspection-templates/${tpl.id}/publish`);
    const started = await s.pm.browser.post(`${s.base}/inspections`, { templateId: tpl.id });
    const answered = await s.pm.browser.put(
      `${s.base}/inspections/${started.json().inspection.id}/responses`,
      { responses: [{ templateItemId: item.id, result: 'pass' }] },
    );
    expect(answered.statusCode).toBe(200);

    const obs = await s.pm.browser.post(`${s.base}/observations`, {
      type: 'quality',
      description: 'Fire collar missing at riser',
      tradeCategory: 'fire_safety',
      classification: 'serious_defect',
      contributingCondition: 'workmanship',
    });
    expect(obs.statusCode).toBe(201);
    expect(obs.json().classification).toBe('serious_defect');

    const res = await s.pm.browser.get(`/v1/orgs/${s.org.id}/dbp-insights`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const fire = body.categories.find((c: { category: string }) => c.category === 'fire_safety');
    expect(fire.itemsPassing).toEqual({ pass: 1, fail: 0, rate: 100 });
    expect(fire.classifications.serious_defect).toBe(1);
    expect(body.classificationTotals.serious_defect).toBe(1);
    expect(body.conditions).toContainEqual({ condition: 'workmanship', count: 1 });
    expect(body.projects[0]).toMatchObject({ name: 'Tower Q', restricted: false });
    expect(body.passRateTrend).toHaveLength(12);

    // A subcontractor has no org role, so the company view is closed to them.
    expect((await s.sub.browser.get(`/v1/orgs/${s.org.id}/dbp-insights`)).statusCode).toBe(403);
  });
});
