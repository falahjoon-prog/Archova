import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  clearFlagTargets,
  createOrg,
  createProject,
  createTestContext,
  enableFlag,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

// Tender invites can require prequalification (precon): off by default; when on, only companies with an approved form
// still in date can be invited, unless a person who can decide overrides with a reason.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_prequalification');
  await t.close();
});

async function setup() {
  const pm = await signUp(t.app, 'gate-pm');
  const tiler = await signUp(t.app, 'gate-tiler');
  const sparky = await signUp(t.app, 'gate-sparky');
  const org = await createOrg(pm.browser, 'Gate Builders');
  await enableFlag(t, 'subcontractor_prequalification', org.id);
  const project = await createProject(pm.browser, org.id, { name: 'Tower G', state: 'QLD' });
  const coTiler = await addMember(
    pm.browser,
    org.id,
    project.id,
    tiler.email,
    'Subcontractor',
    'Tiles G',
  );
  const coSparky = await addMember(
    pm.browser,
    org.id,
    project.id,
    sparky.email,
    'Subcontractor',
    'Sparky G',
  );
  return {
    pm: pm.browser,
    base: `/v1/orgs/${org.id}`,
    project: `/v1/orgs/${org.id}/projects/${project.id}`,
    tiler: coTiler.companyId,
    sparky: coSparky.companyId,
  };
}

const newPackage = async (b: Browser, project: string, name: string) => {
  const res = await b.post(`${project}/tender-packages`, {
    name,
    trade: 'Tiling',
    dueAt: '2031-01-15T05:00:00Z',
    scope: [{ key: 'floor', description: 'Floor', quantity: '10', unit: 'm2', source: 'typed' }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
};

/** Prequalify a company end to end: published form, answers, submit, approve. */
async function prequalify(b: Browser, base: string, companyId: string) {
  const tpl = await b.post(`${base}/prequal-templates`, {
    name: `Form ${Math.random()}`,
    questions: [
      {
        id: 'cover',
        section: '',
        prompt: 'Do you hold insurance?',
        type: 'yes_no',
        options: [],
        required: true,
        expect: 'yes',
        points: 10,
        critical: false,
      },
    ],
  });
  const published = await b.post(`${base}/prequal-templates/${tpl.json().id}/publish`, undefined, {
    'if-match': tpl.headers.etag as string,
  });
  const form = await b.post(`${base}/prequalifications`, {
    companyId,
    templateId: published.json().id,
  });
  const saved = await b.patch(
    `${base}/prequalifications/${form.json().id}`,
    { answers: { cover: true } },
    { 'if-match': form.headers.etag as string },
  );
  const submitted = await b.post(`${base}/prequalifications/${form.json().id}/submit`, undefined, {
    'if-match': saved.headers.etag as string,
  });
  const approved = await b.post(
    `${base}/prequalifications/${form.json().id}/approve`,
    {},
    {
      'if-match': submitted.headers.etag as string,
    },
  );
  expect(approved.statusCode, approved.body).toBe(200);
}

describe('tender invites and prequalification', () => {
  it('invites anyone until the requirement is switched on', async () => {
    const s = await setup();
    const settings = await s.pm.get(`${s.base}/prequalification-settings`);
    expect(settings.json()).toEqual({ requireForTenders: false });
    const pkg = await newPackage(s.pm, s.project, 'Open');
    const res = await s.pm.post(`${s.project}/tender-packages/${pkg}/invites`, {
      companyIds: [s.tiler],
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses companies that are not prequalified, lets a qualified one in, and records an override', async () => {
    const s = await setup();
    const early = await newPackage(s.pm, s.project, 'Before');
    // Already invited before the rule: stays invited and can be listed again.
    expect(
      (await s.pm.post(`${s.project}/tender-packages/${early}/invites`, { companyIds: [s.tiler] }))
        .statusCode,
    ).toBe(200);

    const on = await s.pm.put(`${s.base}/prequalification-settings`, { requireForTenders: true });
    expect(on.json()).toEqual({ requireForTenders: true });

    expect(
      (await s.pm.post(`${s.project}/tender-packages/${early}/invites`, { companyIds: [s.tiler] }))
        .statusCode,
    ).toBe(200);

    const pkg = await newPackage(s.pm, s.project, 'After');
    const refused = await s.pm.post(`${s.project}/tender-packages/${pkg}/invites`, {
      companyIds: [s.tiler, s.sparky],
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('tender.company_not_qualified');
    expect(JSON.stringify(refused.json())).toContain('companyIds/0');
    expect(JSON.stringify(refused.json())).toContain('companyIds/1');
    // Nothing was invited by the refused request.
    expect((await s.pm.get(`${s.project}/tender-packages/${pkg}`)).json().invites).toHaveLength(0);

    await prequalify(s.pm, s.base, s.tiler);
    const partly = await s.pm.post(`${s.project}/tender-packages/${pkg}/invites`, {
      companyIds: [s.tiler, s.sparky],
    });
    expect(partly.statusCode).toBe(422);
    const ok = await s.pm.post(`${s.project}/tender-packages/${pkg}/invites`, {
      companyIds: [s.tiler],
    });
    expect(ok.statusCode, ok.body).toBe(200);

    // A person who can decide may override, and the reason is recorded.
    const over = await s.pm.post(`${s.project}/tender-packages/${pkg}/invites`, {
      companyIds: [s.sparky],
      overrideReason: 'Long-standing supplier, form in progress',
    });
    expect(over.statusCode, over.body).toBe(200);
    expect(over.json().invites).toHaveLength(2);
  });
});
