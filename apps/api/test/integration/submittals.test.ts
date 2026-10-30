import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  outboxData,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'sub-pm');
  const arch = await signUp(t.app, 'sub-arch');
  const eng = await signUp(t.app, 'sub-eng');
  const steel = await signUp(t.app, 'sub-steel');
  const outsider = await signUp(t.app, 'sub-outsider');
  const org = await createOrg(pm.browser, 'Submittal Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, arch.email, 'Consultant', 'Archi');
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Smith Engineers');
  const steelCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    steel.email,
    'Subcontractor',
    'Steelco',
  );
  const outsiderCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    outsider.email,
    'Subcontractor',
    'Plumbco',
  );
  return { pm, arch, eng, steel, outsider, org, project, base, steelCo, outsiderCo };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('submittal register and review (product/04)', () => {
  it('registers an item with its submit-by date, runs a two-consultant review, returns and resubmits', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Level 2 transfer beam shop drawings',
      type: 'shop_drawing',
      specSection: '0331 Concrete',
      responsibleCompanyId: s.steelCo.companyId,
      requiredOnSite: '2027-03-26',
      leadTimeDays: 5,
      reviewDays: 10,
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().submittal;
    // Fri 26 Mar 2027 minus 15 business days.
    expect(item).toMatchObject({
      number: 1,
      numberLabel: 'SD-001',
      status: 'draft',
      submitBy: '2027-03-05',
      managerId: s.pm.userId,
      ballInCourt: { side: 'subcontractor' },
    });

    // The responsible subcontractor sees it; another subcontractor doesn't.
    expect((await s.steel.browser.get(`${s.base}/submittals/${item.id}`)).statusCode).toBe(200);
    expect((await s.outsider.browser.get(`${s.base}/submittals/${item.id}`)).statusCode).toBe(404);
    expect((await s.outsider.browser.get(`${s.base}/submittals`)).json().data).toEqual([]);

    // Submitting needs the package.
    expect(
      (
        await s.steel.browser.post(
          `${s.base}/submittals/${item.id}/submit`,
          { fileIds: [] },
          { 'if-match': etagOf(created) },
        )
      ).statusCode,
    ).toBe(422);
    const pkg = await uploadFile(
      t,
      s.steel.browser,
      s.org.id,
      s.project.id,
      'beam.pdf',
      'submittals',
    );
    const submitted = await s.steel.browser.post(
      `${s.base}/submittals/${item.id}/submit`,
      { fileIds: [pkg], reviewerIds: [s.arch.userId, s.eng.userId], note: 'Rev 0 for review' },
      { 'if-match': etagOf(created) },
    );
    expect(submitted.statusCode).toBe(200);
    const sub = submitted.json();
    expect(sub.submittal).toMatchObject({
      status: 'submitted',
      currentRevision: 0,
      ballInCourt: { side: 'builder', userIds: [s.pm.userId] },
    });
    expect(sub.revisions[0].steps.map((x: { kind: string }) => x.kind)).toEqual([
      'builder',
      'consultant',
      'consultant',
    ]);
    const [builderStep, archStep, engStep] = sub.revisions[0].steps;

    // Only the person whose turn it is can answer; the builder must forward rather than approve.
    expect(
      (
        await s.steel.browser.post(
          `${s.base}/submittals/${item.id}/steps/${builderStep.id}/respond`,
          {
            response: 'forwarded',
          },
        )
      ).json().code,
    ).toBe('submittal.review_not_allowed');
    expect(
      (
        await s.arch.browser.post(`${s.base}/submittals/${item.id}/steps/${archStep.id}/respond`, {
          response: 'approved',
        })
      ).json().code,
    ).toBe('submittal.invalid_transition');
    expect(
      (
        await s.pm.browser.post(`${s.base}/submittals/${item.id}/steps/${builderStep.id}/respond`, {
          response: 'approved',
        })
      ).json().code,
    ).toBe('submittal.invalid_transition');
    const forwarded = await s.pm.browser.post(
      `${s.base}/submittals/${item.id}/steps/${builderStep.id}/respond`,
      { response: 'forwarded', comments: 'Checked against the structure drawings' },
    );
    expect(forwarded.statusCode).toBe(200);
    expect(forwarded.json().submittal).toMatchObject({
      status: 'in_review',
      ballInCourt: { side: 'consultant', userIds: [s.arch.userId] },
    });

    // The second consultant can't jump the queue.
    expect(
      (
        await s.eng.browser.post(`${s.base}/submittals/${item.id}/steps/${engStep.id}/respond`, {
          response: 'approved',
        })
      ).json().code,
    ).toBe('submittal.invalid_transition');
    await s.arch.browser.post(`${s.base}/submittals/${item.id}/steps/${archStep.id}/respond`, {
      response: 'approved_as_noted',
      comments: 'Add the camber note',
    });
    const returned = await s.eng.browser.post(
      `${s.base}/submittals/${item.id}/steps/${engStep.id}/respond`,
      { response: 'revise_resubmit', comments: 'Weld sizes do not match S-301' },
    );
    expect(returned.statusCode).toBe(200);
    expect(returned.json().submittal).toMatchObject({
      status: 'revise_resubmit',
      ballInCourt: { side: 'subcontractor' },
    });
    expect(returned.json().revisions[0]).toMatchObject({ status: 'revise_resubmit' });

    // The return is published with the comments for the subcontractor's email (SUB-AC5).
    const events = await outboxData<{ comments: string; status: string }>(
      t,
      s.org.id,
      s.pm.userId,
      'submittals.submittal.returned.v1',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      comments: 'Weld sizes do not match S-301',
      status: 'revise_resubmit',
    });

    // Resubmitting opens revision 1 on the same path; the history stays.
    const pkg2 = await uploadFile(
      t,
      s.steel.browser,
      s.org.id,
      s.project.id,
      'beam-r1.pdf',
      'submittals',
    );
    const resub = await s.steel.browser.post(
      `${s.base}/submittals/${item.id}/submit`,
      { fileIds: [pkg2] },
      { 'if-match': etagOf(returned) },
    );
    expect(resub.statusCode).toBe(200);
    expect(resub.json().submittal).toMatchObject({ status: 'submitted', currentRevision: 1 });
    expect(resub.json().revisions).toHaveLength(2);
    expect(resub.json().revisions[1].steps).toHaveLength(3);
    const r1 = resub.json().revisions[1].steps;

    await s.pm.browser.post(`${s.base}/submittals/${item.id}/steps/${r1[0].id}/respond`, {
      response: 'forwarded',
    });
    await s.arch.browser.post(`${s.base}/submittals/${item.id}/steps/${r1[1].id}/respond`, {
      response: 'approved',
    });
    const approved = await s.eng.browser.post(
      `${s.base}/submittals/${item.id}/steps/${r1[2].id}/respond`,
      {
        response: 'approved_as_noted',
      },
    );
    // The most severe response applies to the whole revision.
    expect(approved.json().submittal).toMatchObject({
      status: 'approved_as_noted',
      ballInCourt: { side: null },
    });

    // Closing needs admin: the PM closes, the subcontractor can't.
    expect(
      (
        await s.steel.browser.post(`${s.base}/submittals/${item.id}/close`, undefined, {
          'if-match': etagOf(approved),
        })
      ).statusCode,
    ).toBe(403);
    const closed = await s.pm.browser.post(`${s.base}/submittals/${item.id}/close`, undefined, {
      'if-match': etagOf(approved),
    });
    expect(closed.json().submittal.status).toBe('closed');
  });

  it('numbers items, takes a company number once, and filters the register', async () => {
    const s = await setup();
    const a = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Glazing samples',
      type: 'sample',
    });
    const b = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Hardware schedule',
      numberLabel: '0875-1',
      type: 'product_data',
    });
    expect([a.json().submittal.numberLabel, b.json().submittal.numberLabel]).toEqual([
      'SD-001',
      '0875-1',
    ]);
    const dup = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Again',
      numberLabel: '0875-1',
    });
    expect(dup.json().code).toBe('submittal.number_taken');
    const samples = await s.pm.browser.get(`${s.base}/submittals?type=sample`);
    expect(samples.json().data.map((x: { numberLabel: string }) => x.numberLabel)).toEqual([
      'SD-001',
    ]);
    const found = await s.pm.browser.get(`${s.base}/submittals?q=hardware`);
    expect(found.json().data).toHaveLength(1);
  });

  it('lets the builder return a status itself without consultants', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Paint colour sample',
      type: 'sample',
      responsibleCompanyId: s.steelCo.companyId,
    });
    const item = created.json().submittal;
    const pkg = await uploadFile(
      t,
      s.steel.browser,
      s.org.id,
      s.project.id,
      'swatch.pdf',
      'submittals',
    );
    const sub = await s.steel.browser.post(
      `${s.base}/submittals/${item.id}/submit`,
      { fileIds: [pkg] },
      { 'if-match': etagOf(created) },
    );
    const step = sub.json().revisions[0].steps[0];
    const done = await s.pm.browser.post(
      `${s.base}/submittals/${item.id}/steps/${step.id}/respond`,
      {
        response: 'approved',
      },
    );
    expect(done.json().submittal.status).toBe('approved');
  });

  it('keeps outside users to their own company', async () => {
    const s = await setup();
    // A subcontractor can't raise an item for another company, nor move their own onto one.
    const other = await s.steel.browser.post(`${s.base}/submittals`, {
      title: 'Not mine',
      responsibleCompanyId: s.pm.companyId ?? s.steelCo.companyId,
    });
    expect(other.statusCode).toBe(201);
    expect(other.json().submittal.responsibleCompanyId).toBe(s.steelCo.companyId);
    const moved = await s.steel.browser.patch(
      `${s.base}/submittals/${other.json().submittal.id}`,
      { responsibleCompanyId: s.outsiderCo.companyId },
      { 'if-match': etagOf(other) },
    );
    expect(moved.statusCode).toBe(403);
    // A company's item can't be edited or submitted by another company.
    const mine = await s.pm.browser.post(`${s.base}/submittals`, {
      title: 'Steel',
      responsibleCompanyId: s.steelCo.companyId,
    });
    const hijack = await s.outsider.browser.patch(
      `${s.base}/submittals/${mine.json().submittal.id}`,
      { title: 'x' },
      { 'if-match': etagOf(mine) },
    );
    expect(hijack.statusCode).toBe(404);
  });
});
