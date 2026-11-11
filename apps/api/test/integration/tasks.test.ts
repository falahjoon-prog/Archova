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
  const pm = await signUp(t.app, 'tsk-pm');
  const sub = await signUp(t.app, 'tsk-sub');
  const org = await createOrg(pm.browser, 'Task Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'VIC' });
  const other = await createProject(pm.browser, org.id, { name: 'Tower U', state: 'VIC' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Steelco');
  return {
    pm,
    sub,
    org,
    project,
    other,
    base: `/v1/orgs/${org.id}/projects/${project.id}`,
    otherBase: `/v1/orgs/${org.id}/projects/${other.id}`,
  };
}

type Mine = {
  data: Array<{ source: string; title: string; bucket: string; projectName: string; id: string }>;
  digest: { overdue: number; dueToday: number; summary: string };
};

describe('tasks and the my-tasks rollup', () => {
  it('creates, edits and completes a task, and lists it by project and in my tasks', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/tasks`, {
      title: '  Order   rebar ',
      assigneeId: s.pm.userId,
      dueDate: '2020-01-01',
      priority: 'high',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().id).toMatch(/^tsk_/);
    expect(created.json().title).toBe('Order rebar');
    expect(created.json().number).toBe(1);

    const mine = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/my-tasks`)).json() as Mine;
    const row = mine.data.find((r) => r.title === 'Order rebar')!;
    expect(row.source).toBe('task');
    expect(row.bucket).toBe('overdue');
    expect(row.projectName).toBe('Tower T');
    expect(mine.digest.overdue).toBeGreaterThanOrEqual(1);
    expect(mine.digest.summary).toMatch(/overdue/);

    const done = await s.pm.browser.patch(`${s.base}/tasks/${created.json().id}`, {
      status: 'done',
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().completedAt).not.toBeNull();

    const open = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/my-tasks`)).json() as Mine;
    expect(open.data.find((r) => r.id === created.json().id)).toBeUndefined();
    const recent = (
      await s.pm.browser.get(`/v1/orgs/${s.org.id}/my-tasks?status=done`)
    ).json() as Mine;
    expect(recent.data.map((r) => r.id)).toContain(created.json().id);

    const projectList = (await s.pm.browser.get(`${s.base}/tasks?status=all`)).json();
    expect(projectList.data).toHaveLength(1);
    expect((await s.pm.browser.get(`${s.otherBase}/tasks?status=all`)).json().data).toEqual([]);
  });

  it('rolls up meeting and incident actions assigned to me, and only to me', async () => {
    const s = await setup();
    const series = (
      await s.pm.browser.post(`${s.base}/meeting-series`, {
        name: 'Site meeting',
        template: 'pcg',
        cadence: 'Weekly',
        defaultAttendees: [],
      })
    ).json();
    const meeting = (
      await s.pm.browser.post(`${s.base}/meeting-series/${series.id}/meetings`, {
        heldAt: '2030-03-04T22:00:00Z',
      })
    ).json();
    const section = meeting.sections[0];
    const mine = await s.pm.browser.post(`${s.base}/meetings/${meeting.meeting.id}/items`, {
      sectionId: section.id,
      kind: 'action',
      body: 'Confirm crane booking',
      ownerUserId: s.pm.userId,
      dueDate: '2020-02-02',
    });
    expect(mine.statusCode).toBe(201);
    await s.pm.browser.post(`${s.base}/meetings/${meeting.meeting.id}/items`, {
      sectionId: section.id,
      kind: 'action',
      body: 'Someone else task',
      ownerName: 'Not a user',
    });

    const incident = (
      await s.pm.browser.post(`${s.base}/incidents`, {
        title: 'Near miss at hoist',
        type: 'near_miss',
        occurredAt: new Date().toISOString(),
      })
    ).json();
    const added = await s.pm.browser.post(`${s.base}/incidents/${incident.incident.id}/actions`, {
      title: 'Fit hoist guard',
      assigneeUserId: s.pm.userId,
      dueDate: '2020-03-03',
    });
    expect(added.statusCode).toBe(201);

    const rolled = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/my-tasks`)).json() as Mine;
    const by = (source: string) => rolled.data.filter((r) => r.source === source);
    expect(by('meeting_action').map((r) => r.title)).toEqual(['Confirm crane booking']);
    expect(by('incident_action').map((r) => r.title)).toEqual(['Fit hoist guard']);
    expect(rolled.data.every((r) => r.bucket === 'overdue')).toBe(true);
    // Oldest overdue is the first thing to look at.
    expect(rolled.digest.summary).toContain('Start with "Confirm crane booking"');

    // Someone outside the organisation cannot read the rollup.
    const stranger = await signUp(t.app, 'tsk-stranger');
    expect([403, 404]).toContain(
      (await stranger.browser.get(`/v1/orgs/${s.org.id}/my-tasks`)).statusCode,
    );
  });

  it('keeps tasks to the team and edits to the creator or assignee', async () => {
    const s = await setup();
    expect((await s.sub.browser.get(`${s.base}/tasks`)).statusCode).toBe(403);
    expect((await s.sub.browser.post(`${s.base}/tasks`, { title: 'Nope' })).statusCode).toBe(403);
    // Assigning to an outside user is refused.
    expect(
      (await s.pm.browser.post(`${s.base}/tasks`, { title: 'Hi', assigneeId: s.sub.userId }))
        .statusCode,
    ).toBe(422);
    expect((await s.pm.browser.post(`${s.base}/tasks`, { title: '   ' })).statusCode).toBe(422);
    const made = (await s.pm.browser.post(`${s.base}/tasks`, { title: 'Mine' })).json();
    // Wrong project: not found.
    expect(
      (await s.pm.browser.patch(`${s.otherBase}/tasks/${made.id}`, { status: 'done' })).statusCode,
    ).toBe(404);
  });
});
