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

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup() {
  const pm = await signUp(t.app, 'frm-pm');
  const sub = await signUp(t.app, 'frm-sub');
  const org = await createOrg(pm.browser, 'Forms Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower F', state: 'VIC' });
  const other = await createOrg((await signUp(t.app, 'frm-other')).browser, 'Other Builder');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return { pm, sub, org, project, other, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}

describe('forms', () => {
  it('lists the built-in library, starts a form, saves, signs and submits it', async () => {
    const s = await setup();
    const lib = await s.pm.browser.get(`${s.base}/form-templates`);
    expect(lib.statusCode).toBe(200);
    const jha = lib.json().data.find((x: { name: string }) => x.name === 'Job Hazard Analysis');
    expect(jha.id).toBe('library:job-hazard-analysis');
    expect(jha.source).toBe('library');

    const started = await s.pm.browser.post(`${s.base}/forms`, { templateId: jha.id });
    expect(started.statusCode).toBe(201);
    const form = started.json();
    expect(form.form.numberLabel).toBe('FRM-0001');
    expect(form.form.status).toBe('draft');
    const formPath = `${s.base}/forms/${form.form.id}`;

    // Submitting too early lists what is missing.
    const early = await s.pm.browser.post(`${formPath}/submit`, undefined, {
      'if-match': etagOf(started),
    });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe('form.incomplete');

    const saved = await s.pm.browser.patch(
      formPath,
      {
        answers: {
          task: 'Cut slab',
          analysis: [{ job_description: 'Saw cut', hazard: 'Dust', controls: 'Wet cutting' }],
        },
      },
      { 'if-match': etagOf(started) },
    );
    expect(saved.statusCode).toBe(200);

    const stale = await s.pm.browser.patch(
      formPath,
      { title: 'x' },
      { 'if-match': etagOf(started) },
    );
    expect(stale.statusCode).toBe(412);

    const signed = await s.pm.browser.post(`${formPath}/signatures`, {
      fieldKey: 'crew_signoff',
      signerName: 'Dana Smith',
    });
    expect(signed.statusCode).toBe(201);
    expect(signed.json().signatures).toHaveLength(1);
    const dup = await s.pm.browser.post(`${formPath}/signatures`, {
      fieldKey: 'crew_signoff',
      signerName: ' dana  smith ',
    });
    expect(dup.statusCode).toBe(409);
    const wrongField = await s.pm.browser.post(`${formPath}/signatures`, {
      fieldKey: 'task',
      signerName: 'Lee Wong',
    });
    expect(wrongField.statusCode).toBe(422);

    // Nova: nobody signed in to site, so the signer is flagged.
    expect(signed.json().flags[0].kind).toBe('signer_not_on_site');
    const attention = await s.pm.browser.get(`${s.base}/forms/attention`);
    expect(
      attention.json().data.some((f: { kind: string }) => f.kind === 'signer_not_on_site'),
    ).toBe(true);

    const done = await s.pm.browser.post(`${formPath}/submit`, undefined, {
      'if-match': etagOf(signed),
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().form.status).toBe('submitted');
    expect(done.json().canEdit).toBe(false);

    const after = await s.pm.browser.patch(formPath, { title: 'y' }, { 'if-match': etagOf(done) });
    expect(after.statusCode).toBe(409);
    expect(after.json().code).toBe('form.already_submitted');

    const listed = await s.pm.browser.get(
      `${s.base}/forms?templateId=${encodeURIComponent(jha.id)}`,
    );
    expect(listed.json().data).toHaveLength(1);
    expect(listed.json().data[0].signatureCount).toBe(1);
  });

  it('builds a custom template, keeps started forms unchanged, and keeps templates admin-only', async () => {
    const s = await setup();
    const orgPath = `/v1/orgs/${s.org.id}/form-templates`;
    const bad = await s.pm.browser.post(orgPath, {
      name: 'Concrete pour',
      fields: [{ key: 'mix', type: 'select', label: 'Mix' }],
    });
    expect(bad.statusCode).toBe(422);

    const made = await s.pm.browser.post(orgPath, {
      name: 'Concrete pour',
      category: 'quality',
      linkModule: 'diary',
      fields: [
        { key: 'mix', type: 'select', label: 'Mix', options: ['N32', 'N40'], required: true },
        { key: 'sign', type: 'signature', label: 'Foreman', slots: 1 },
      ],
    });
    expect(made.statusCode).toBe(201);
    const tpl = made.json();
    expect(tpl.id).toMatch(/^frt_/);
    expect((await s.pm.browser.post(orgPath, { name: 'concrete POUR' })).statusCode).toBe(409);

    const form = await s.pm.browser.post(`${s.base}/forms`, { templateId: tpl.id });
    expect(form.statusCode).toBe(201);

    const edited = await s.pm.browser.patch(
      `${orgPath}/${tpl.id}`,
      { fields: [{ key: 'mix', type: 'text', label: 'Mix' }] },
      { 'if-match': etagOf(made) },
    );
    expect(edited.statusCode).toBe(200);
    const again = await s.pm.browser.get(`${s.base}/forms/${form.json().form.id}`);
    expect(again.json().fields).toHaveLength(2);

    // A copied built-in replaces the original in the picker.
    const copy = await s.pm.browser.post(orgPath, { copyFromLibraryKey: 'toolbox-talk' });
    expect(copy.statusCode).toBe(201);
    const names = (await s.pm.browser.get(`${s.base}/form-templates`))
      .json()
      .data.map((x: { name: string; id: string }) => x.name + ':' + x.id.split(':')[0]);
    expect(names.filter((n: string) => n.startsWith('Toolbox Talk'))).toHaveLength(1);

    // A subcontractor can fill forms but not build templates.
    expect((await s.sub.browser.post(orgPath, { name: 'Mine' })).statusCode).toBe(403);
    const subForm = await s.sub.browser.post(`${s.base}/forms`, { templateId: tpl.id });
    expect(subForm.statusCode).toBe(201);
  });

  it("never shows another organisation's templates or forms", async () => {
    const s = await setup();
    const mine = await s.pm.browser.post(`/v1/orgs/${s.org.id}/form-templates`, {
      name: 'Private',
    });
    expect(mine.statusCode).toBe(201);
    const stranger = await signUp(t.app, 'frm-stranger');
    const res = await stranger.browser.get(`${s.base}/form-templates`);
    expect([403, 404]).toContain(res.statusCode);
    const start = await stranger.browser.post(`${s.base}/forms`, { templateId: mine.json().id });
    expect([403, 404]).toContain(start.statusCode);
  });
});
