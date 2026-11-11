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

const fields = [
  {
    id: 'site',
    section: 'Details',
    label: 'Site',
    type: 'text',
    required: true,
    prefillKey: 'project.name',
  },
  {
    id: 'what',
    section: 'Details',
    label: 'What happened',
    type: 'long_text',
    prefillKey: 'incident.description',
  },
  {
    id: 'sev',
    section: 'Details',
    label: 'Severity',
    type: 'single_select',
    options: ['low', 'medium', 'high', 'critical'],
    prefillKey: 'incident.severity',
  },
  { id: 'safe', section: 'Sign-off', label: 'Area made safe', type: 'yes_no', required: true },
];

async function setup() {
  const pm = await signUp(t.app, 'frm-pm');
  const sub = await signUp(t.app, 'frm-sub');
  const org = await createOrg(pm.browser, 'Forms Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower F', state: 'QLD' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  return { pm, sub, org, project, base };
}

async function published(s: Awaited<ReturnType<typeof setup>>, name = 'Safety walk') {
  const made = await s.pm.browser.post(`${s.base}/form-templates`, { name, fields });
  expect(made.statusCode, made.body).toBe(201);
  const pub = await s.pm.browser.post(`${s.base}/form-templates/${made.json().id}/publish`, {});
  expect(pub.statusCode, pub.body).toBe(200);
  return pub.json() as { id: string; version: number; status: string };
}

describe('forms', () => {
  it('builds a template, freezes it on publish and versions it', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/form-templates`, { name: 'Pre-pour', fields });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({
      status: 'draft',
      version: 1,
      id: expect.stringMatching(/^frt_/),
    });
    expect(draft.json().fields[0]).toMatchObject({ section: 'Details', required: true });

    const dup = await s.pm.browser.post(`${s.base}/form-templates`, { name: 'pre-pour', fields });
    expect(dup.statusCode).toBe(409);
    const badFields = await s.pm.browser.put(`${s.base}/form-templates/${draft.json().id}`, {
      name: 'Pre-pour',
      fields: [fields[0], fields[0]],
    });
    expect(badFields.statusCode).toBe(422);
    const empty = await s.pm.browser.post(`${s.base}/form-templates`, {
      name: 'Empty',
      fields: [],
    });
    expect(
      (await s.pm.browser.post(`${s.base}/form-templates/${empty.json().id}/publish`, {}))
        .statusCode,
    ).toBe(422);

    const v1 = await s.pm.browser.post(`${s.base}/form-templates/${draft.json().id}/publish`, {});
    expect(v1.json().status).toBe('published');
    // Frozen: edits are refused, a new version is a copy.
    expect(
      (
        await s.pm.browser.put(`${s.base}/form-templates/${draft.json().id}`, {
          name: 'Pre-pour',
          fields,
        })
      ).statusCode,
    ).toBe(409);
    const v2 = await s.pm.browser.post(`${s.base}/form-templates/${draft.json().id}/versions`, {});
    expect(v2.statusCode).toBe(201);
    expect(v2.json()).toMatchObject({ version: 2, status: 'draft' });
    expect(
      (await s.pm.browser.post(`${s.base}/form-templates/${draft.json().id}/versions`, {}))
        .statusCode,
    ).toBe(409);
    await s.pm.browser.post(`${s.base}/form-templates/${v2.json().id}/publish`, {});
    const list = (await s.pm.browser.get(`${s.base}/form-templates`)).json().data as Array<{
      version: number;
      status: string;
      name: string;
    }>;
    expect(list.filter((x) => x.name === 'Pre-pour').map((x) => [x.version, x.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ]);
  });

  it('assigns, saves progress, enforces required fields on submit, then closes', async () => {
    const s = await setup();
    const tpl = await published(s);
    const made = await s.pm.browser.post(`${s.base}/form-submissions`, {
      templateId: tpl.id,
      assigneeId: s.sub.userId,
      dueDate: '2099-01-01',
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().submission.id as string;
    expect(made.json().submission).toMatchObject({
      status: 'assigned',
      numberLabel: 'FRM-0001',
      missingRequiredCount: 2,
    });

    // The assignee gets a notification and can open and fill the form.
    const inbox = (await s.sub.browser.get(`/v1/orgs/${s.org.id}/notifications`)).json();
    const n = inbox.data.find((x: { kind: string }) => x.kind === 'forms.assigned');
    expect(n).toMatchObject({ entityType: 'form_submission', entityId: id });
    const mine = await s.sub.browser.get(`${s.base}/form-submissions/${id}`);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().canFill).toBe(true);
    // The assignee cannot open the template list, or start forms for others.
    expect((await s.sub.browser.get(`${s.base}/form-templates`)).statusCode).toBe(404);
    expect(
      (await s.sub.browser.post(`${s.base}/form-submissions`, { templateId: tpl.id })).statusCode,
    ).toBe(403);

    expect(
      (
        await s.sub.browser.put(`${s.base}/form-submissions/${id}/answers`, {
          answers: { sev: 'bad' },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await s.sub.browser.put(`${s.base}/form-submissions/${id}/answers`, {
          answers: { nope: 'x' },
        })
      ).statusCode,
    ).toBe(422);
    const saved = await s.sub.browser.put(`${s.base}/form-submissions/${id}/answers`, {
      answers: { site: 'Level 3' },
    });
    expect(saved.json().submission).toMatchObject({
      status: 'in_progress',
      missingRequiredCount: 1,
    });
    expect(saved.json().answers).toEqual({ site: 'Level 3' });

    const early = await s.sub.browser.post(`${s.base}/form-submissions/${id}/submit`, {});
    expect(early.statusCode).toBe(422);
    await s.sub.browser.put(`${s.base}/form-submissions/${id}/answers`, {
      answers: { safe: false },
    });
    const done = await s.sub.browser.post(`${s.base}/form-submissions/${id}/submit`, {});
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().submission.status).toBe('submitted');
    expect(done.json().canFill).toBe(false);
    expect(
      (
        await s.sub.browser.put(`${s.base}/form-submissions/${id}/answers`, {
          answers: { site: 'x' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await s.sub.browser.post(`${s.base}/form-submissions/${id}/review`, { decision: 'close' }))
        .statusCode,
    ).toBe(403);

    const returned = await s.pm.browser.post(`${s.base}/form-submissions/${id}/review`, {
      decision: 'return',
    });
    expect(returned.json().submission.status).toBe('in_progress');
    await s.sub.browser.post(`${s.base}/form-submissions/${id}/submit`, {});
    const closed = await s.pm.browser.post(`${s.base}/form-submissions/${id}/review`, {
      decision: 'close',
    });
    expect(closed.json().submission.status).toBe('closed');
  });

  it('raises Nova flags on overdue forms and keeps outside users to their own', async () => {
    const s = await setup();
    const tpl = await published(s);
    // A due date in the past is refused up front, so make one that is due today (flagged due_soon).
    const today = new Date().toISOString().slice(0, 10);
    const soon = await s.pm.browser.post(`${s.base}/form-submissions`, {
      templateId: tpl.id,
      assigneeId: s.pm.userId,
      dueDate: today,
    });
    const calm = await s.pm.browser.post(`${s.base}/form-submissions`, {
      templateId: tpl.id,
      assigneeId: s.sub.userId,
    });
    expect(
      (
        await s.pm.browser.post(`${s.base}/form-submissions`, {
          templateId: tpl.id,
          dueDate: '2001-01-01',
        })
      ).statusCode,
    ).toBe(422);
    expect(soon.json().submission.flags.length).toBeGreaterThan(0);

    const flagged = (await s.pm.browser.get(`${s.base}/form-submissions?flagged=true`)).json();
    expect(flagged.data.map((x: { id: string }) => x.id)).toEqual([soon.json().submission.id]);
    const all = (await s.pm.browser.get(`${s.base}/form-submissions?limit=1`)).json();
    expect(all.data).toHaveLength(1);
    expect(all.nextCursor).toBeTruthy();

    const theirs = (await s.sub.browser.get(`${s.base}/form-submissions`)).json();
    expect(theirs.data.map((x: { id: string }) => x.id)).toEqual([calm.json().submission.id]);
    expect(
      (await s.sub.browser.get(`${s.base}/form-submissions/${soon.json().submission.id}`))
        .statusCode,
    ).toBe(404);
  });

  it('offers pre-fill from the project and a related incident without saving it', async () => {
    const s = await setup();
    const tpl = await published(s);
    const incident = (
      await s.pm.browser.post(`${s.base}/incidents`, {
        title: 'Scaffold gap',
        type: 'near_miss',
        severity: 'high',
        description: 'Gap in the edge protection on level 2.',
        occurredAt: new Date(Date.now() - 3600_000).toISOString(),
      })
    ).json();
    expect(incident.incident?.id, JSON.stringify(incident)).toBeTruthy();
    const made = await s.pm.browser.post(`${s.base}/form-submissions`, {
      templateId: tpl.id,
      relatedType: 'incident',
      relatedId: incident.incident.id,
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().submission.id as string;
    const sugg = (
      await s.pm.browser.post(`${s.base}/form-submissions/${id}/suggestions`, {})
    ).json().data as Array<{ fieldId: string; value: unknown; source: string }>;
    expect(sugg).toEqual([
      { fieldId: 'site', value: 'Tower F', source: 'Project' },
      { fieldId: 'what', value: 'Gap in the edge protection on level 2.', source: 'Incident' },
      { fieldId: 'sev', value: 'high', source: 'Incident' },
    ]);
    expect((await s.pm.browser.get(`${s.base}/form-submissions/${id}`)).json().answers).toEqual({});
    // Once answered, a field is no longer offered.
    await s.pm.browser.put(`${s.base}/form-submissions/${id}/answers`, {
      answers: { site: 'Mine' },
    });
    const again = (
      await s.pm.browser.post(`${s.base}/form-submissions/${id}/suggestions`, {})
    ).json().data;
    expect(again.map((x: { fieldId: string }) => x.fieldId)).toEqual(['what', 'sev']);

    const wrong = await s.pm.browser.post(`${s.base}/form-submissions`, {
      templateId: tpl.id,
      relatedType: 'incident',
      relatedId: 'inx_00000000000000000000000000',
    });
    expect([404, 422]).toContain(wrong.statusCode);
  });
});
