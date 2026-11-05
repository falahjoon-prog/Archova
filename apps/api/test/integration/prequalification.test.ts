import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearFlagTargets,
  createOrg,
  createTestContext,
  enableFlag,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

// Subcontractor prequalification (phase 4): behind its flag, a published form per company, a person decides, and
// "currently qualified" is worked out from the expiry date when asked.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_prequalification');
  await t.close();
});

const questions = [
  {
    id: 'workers-comp',
    section: 'Insurance',
    prompt: 'Do you hold current workers compensation cover?',
    type: 'yes_no',
    options: [],
    required: true,
    expect: 'yes',
    points: 40,
    critical: true,
  },
  {
    id: 'lti',
    section: 'Safety',
    prompt: 'Lost-time injuries in the last 12 months?',
    type: 'number',
    options: [],
    required: true,
    expect: null,
    points: 0,
    critical: false,
  },
];

async function setup(label: string) {
  const u = await signUp(t.app, label);
  const org = await createOrg(u.browser, `${label} Co`);
  await enableFlag(t, 'subcontractor_prequalification', org.id);
  const company = (
    await u.browser.post(`/v1/orgs/${org.id}/companies`, {
      name: 'Sparky Electrical',
      type: 'subcontractor',
      trades: ['Electrical'],
    })
  ).json() as { id: string };
  return { u, org, base: `/v1/orgs/${org.id}`, companyId: company.id };
}

async function publishedTemplate(browser: Browser, base: string, name = 'Standard prequal') {
  const created = await browser.post(`${base}/prequal-templates`, {
    name,
    validityMonths: 12,
    questions,
  });
  expect(created.statusCode, created.body).toBe(201);
  const pub = await browser.post(
    `${base}/prequal-templates/${created.json().id}/publish`,
    undefined,
    { 'if-match': created.headers.etag as string },
  );
  expect(pub.statusCode, pub.body).toBe(200);
  return pub.json() as { id: string };
}

describe('prequalification', () => {
  it('is unavailable until the flag is on for the org', async () => {
    const u = await signUp(t.app, 'pq-off');
    const org = await createOrg(u.browser, 'PQ Off Co');
    const res = await u.browser.get(`/v1/orgs/${org.id}/prequal-templates`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('feature-unavailable');
  });

  it('freezes a published form and versions it', async () => {
    const { u, base } = await setup('pq-tpl');
    const bad = await u.browser.post(`${base}/prequal-templates`, {
      name: 'Dup ids',
      questions: [questions[0], questions[0]],
    });
    expect(bad.statusCode).toBe(422);
    const tpl = await publishedTemplate(u.browser, base);
    const edit = await u.browser.patch(
      `${base}/prequal-templates/${tpl.id}`,
      { name: 'Renamed' },
      { 'if-match': '"2"' },
    );
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe('prequal_template.published');
    const v2 = await u.browser.post(`${base}/prequal-templates/${tpl.id}/new-version`);
    expect(v2.statusCode, v2.body).toBe(201);
    expect(v2.json()).toMatchObject({ version: 2, published: false });
    const again = await u.browser.post(`${base}/prequal-templates/${tpl.id}/new-version`);
    expect(again.statusCode).toBe(201);
    expect(again.json().version).toBe(3);
  });

  it('takes a form from draft to approved and shows the company as qualified', async () => {
    const { u, base, companyId } = await setup('pq-flow');
    const tpl = await publishedTemplate(u.browser, base);

    const created = await u.browser.post(`${base}/prequalifications`, {
      companyId,
      templateId: tpl.id,
      trades: ['Electrical'],
    });
    expect(created.statusCode, created.body).toBe(201);
    const form = created.json();
    expect(form).toMatchObject({ status: 'draft', qualification: 'pending', scorePoints: null });

    // Only one unfinished form per company and template.
    const dup = await u.browser.post(`${base}/prequalifications`, {
      companyId,
      templateId: tpl.id,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('prequal.open_exists');

    // Submit is refused until the required questions are answered.
    const early = await u.browser.post(`${base}/prequalifications/${form.id}/submit`, undefined, {
      'if-match': created.headers.etag as string,
    });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe('prequal.incomplete');

    const saved = await u.browser.patch(
      `${base}/prequalifications/${form.id}`,
      { answers: { 'workers-comp': true, lti: 0 } },
      { 'if-match': created.headers.etag as string },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const submitted = await u.browser.post(
      `${base}/prequalifications/${form.id}/submit`,
      undefined,
      {
        'if-match': saved.headers.etag as string,
      },
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json()).toMatchObject({
      status: 'submitted',
      scorePoints: 40,
      scoreMax: 40,
      concerns: [],
    });

    // A rejection needs its reason; an approval sets the expiry from the form's validity.
    const noReason = await u.browser.post(
      `${base}/prequalifications/${form.id}/reject`,
      { note: ' ' },
      {
        'if-match': submitted.headers.etag as string,
      },
    );
    expect(noReason.statusCode).toBe(422);
    const approved = await u.browser.post(
      `${base}/prequalifications/${form.id}/approve`,
      { note: 'Certificates sighted' },
      { 'if-match': submitted.headers.etag as string },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', qualification: 'qualified' });
    expect(approved.json().expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // A decided form cannot be decided again or edited.
    const again = await u.browser.post(
      `${base}/prequalifications/${form.id}/reject`,
      { note: 'x' },
      {
        'if-match': approved.headers.etag as string,
      },
    );
    expect(again.statusCode).toBe(409);

    const register = await u.browser.get(
      `${base}/prequalification-register?state=qualified&trade=electrical`,
    );
    expect(register.statusCode).toBe(200);
    expect(register.json().data).toHaveLength(1);
    expect(register.json().data[0]).toMatchObject({ companyId, qualification: 'qualified' });
    const none = await u.browser.get(`${base}/prequalification-register?state=expired`);
    expect(none.json().data).toHaveLength(0);
  });

  it('flags an unwanted critical answer and lets a person reject', async () => {
    const { u, base, companyId } = await setup('pq-reject');
    const tpl = await publishedTemplate(u.browser, base);
    const created = await u.browser.post(`${base}/prequalifications`, {
      companyId,
      templateId: tpl.id,
    });
    const saved = await u.browser.patch(
      `${base}/prequalifications/${created.json().id}`,
      { answers: { 'workers-comp': false, lti: 2 } },
      { 'if-match': created.headers.etag as string },
    );
    const submitted = await u.browser.post(
      `${base}/prequalifications/${created.json().id}/submit`,
      undefined,
      { 'if-match': saved.headers.etag as string },
    );
    // The concern is shown, but nothing is rejected automatically.
    expect(submitted.json()).toMatchObject({
      status: 'submitted',
      scorePoints: 0,
      concerns: ['workers-comp'],
    });
    const rejected = await u.browser.post(
      `${base}/prequalifications/${created.json().id}/reject`,
      { note: 'No workers compensation cover' },
      { 'if-match': submitted.headers.etag as string },
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', qualification: 'not_qualified' });
    const list = await u.browser.get(
      `${base}/prequalifications?companyId=${companyId}&status=rejected`,
    );
    expect(list.json().data).toHaveLength(1);
  });

  it('keeps one org out of another', async () => {
    const a = await setup('pq-iso-a');
    const b = await setup('pq-iso-b');
    const tpl = await publishedTemplate(a.u.browser, a.base);
    const res = await b.u.browser.get(`${b.base}/prequal-templates/${tpl.id}`);
    expect(res.statusCode).toBe(404);
  });
});
