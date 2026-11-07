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

type Item = {
  id: string;
  number: string;
  title: string;
  types: string[];
  status: string;
  blockedBy: Array<{ number: string }>;
  holdCleared: boolean;
  canClearHold: boolean;
  links: Array<{ type: string; id: string; status: string | null }>;
  requests: Array<{ id: string; status: string }>;
};
type Plan = {
  started: boolean;
  canManage: boolean;
  canClearHolds: boolean;
  phases: Array<{ id: string; number: number; title: string; doneCount: number; items: Item[] }>;
};

async function setup() {
  const pm = await signUp(t.app, 'plan-pm');
  const site = await signUp(t.app, 'plan-site');
  const sub = await signUp(t.app, 'plan-sub');
  const org = await createOrg(pm.browser, 'Plan Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, site.email, 'Site Manager', 'Site Co');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  return { pm, site, sub, org, project, base };
}

describe('Project action plan', () => {
  it('starts from the standard plan once, and a subcontractor cannot see it', async () => {
    const s = await setup();
    expect(((await s.pm.browser.get(`${s.base}/project-plan`)).json() as Plan).started).toBe(false);
    const started = await s.pm.browser.post(`${s.base}/project-plan`);
    expect(started.statusCode).toBe(201);
    const plan = started.json() as Plan;
    expect(plan.phases.map((p) => p.number)).toEqual(plan.phases.map((_, i) => i + 1));
    expect(plan.phases[0]!.items[0]!.number).toBe('1.1');
    expect((await s.pm.browser.post(`${s.base}/project-plan`)).statusCode).toBe(409);
    expect((await s.sub.browser.get(`${s.base}/project-plan`)).statusCode).toBeGreaterThanOrEqual(
      403,
    );
  });

  it('a hold point blocks later items until an admin clears it', async () => {
    const s = await setup();
    const plan = (await s.pm.browser.post(`${s.base}/project-plan`)).json() as Plan;
    const phase = plan.phases[0]!;
    const hold = phase.items.find((i) => i.types.includes('hold_point'))!;
    const before = phase.items.find((i) => i.number < hold.number)!;
    const after = plan.phases[1]!.items[0]!;

    // Work before the hold is free; work after it is blocked, and the plan says by what.
    const done = await s.site.browser.patch(`${s.base}/project-plan/items/${before.id}`, {
      status: 'complete',
    });
    expect(done.statusCode).toBe(200);
    expect(
      ((await s.site.browser.get(`${s.base}/project-plan`)).json() as Plan).phases[1]!.items[0]!
        .blockedBy[0]!.number,
    ).toBe(hold.number);
    const blocked = await s.site.browser.patch(`${s.base}/project-plan/items/${after.id}`, {
      status: 'complete',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('project_plan.blocked_by_hold');

    // A hold is not completed by a status change, and a site manager cannot clear it.
    const viaStatus = await s.pm.browser.patch(`${s.base}/project-plan/items/${hold.id}`, {
      status: 'complete',
    });
    expect(viaStatus.json().code).toBe('project_plan.hold_point_needs_clearing');
    expect(
      (await s.site.browser.post(`${s.base}/project-plan/items/${hold.id}/clear-hold`, {}))
        .statusCode,
    ).toBe(403);

    const cleared = await s.pm.browser.post(`${s.base}/project-plan/items/${hold.id}/clear-hold`, {
      note: 'Owner accepts',
    });
    expect(cleared.statusCode).toBe(200);
    const h = (cleared.json() as Plan).phases[0]!.items.find((i) => i.id === hold.id)!;
    expect(h.status).toBe('complete');
    expect(h.holdCleared).toBe(true);
    expect(
      (await s.pm.browser.post(`${s.base}/project-plan/items/${hold.id}/clear-hold`, {}))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await s.site.browser.patch(`${s.base}/project-plan/items/${after.id}`, {
          status: 'complete',
        })
      ).statusCode,
    ).toBe(200);

    // Reopening the hold puts it back.
    const reopened = await s.pm.browser.patch(`${s.base}/project-plan/items/${hold.id}`, {
      status: 'in_progress',
    });
    expect(
      (reopened.json() as Plan).phases[0]!.items.find((i) => i.id === hold.id)!.holdCleared,
    ).toBe(false);
  });

  it('numbers follow the order, phases and items can be moved, and a phase with items cannot be deleted', async () => {
    const s = await setup();
    const plan = (await s.pm.browser.post(`${s.base}/project-plan`)).json() as Plan;
    const moved = await s.pm.browser.patch(`${s.base}/project-plan/phases/${plan.phases[2]!.id}`, {
      position: 1,
    });
    const m = moved.json() as Plan;
    expect(m.phases[0]!.title).toBe(plan.phases[2]!.title);
    expect(m.phases.map((p) => p.number)).toEqual(m.phases.map((_, i) => i + 1));
    expect(m.phases[0]!.items[0]!.number).toBe('1.1');
    expect(
      (await s.pm.browser.del(`${s.base}/project-plan/phases/${m.phases[0]!.id}`)).statusCode,
    ).toBe(409);
    const added = await s.pm.browser.post(`${s.base}/project-plan/phases`, { title: 'Handover' });
    const last = (added.json() as Plan).phases.at(-1)!;
    expect((await s.pm.browser.del(`${s.base}/project-plan/phases/${last.id}`)).statusCode).toBe(
      200,
    );
    const item = await s.pm.browser.post(`${s.base}/project-plan/phases/${m.phases[0]!.id}/items`, {
      title: 'Council pre-lodgement',
      types: ['meeting', 'notification'],
      dueDate: '2026-12-01',
      parties: [{ kind: 'third_party', label: 'Council' }],
      references: [{ label: 'Planning guide', url: 'https://example.com/guide' }],
    });
    expect(item.statusCode).toBe(201);
    const created = (item.json() as Plan).phases[0]!.items.at(-1)!;
    expect(created.title).toBe('Council pre-lodgement');
    expect((await s.pm.browser.del(`${s.base}/project-plan/items/${created.id}`)).statusCode).toBe(
      200,
    );
  });

  it('links a record, shows its status, asks for photos, and Nova flags overdue items and a matching record', async () => {
    const s = await setup();
    const plan = (await s.pm.browser.post(`${s.base}/project-plan`)).json() as Plan;
    const esa = plan.phases[1]!.items.find((i) => i.title === 'Phase I ESA')!;
    const series = (
      await s.pm.browser.post(`${s.base}/meeting-series`, {
        name: 'Due diligence',
        template: 'custom',
      })
    ).json() as { id: string };
    const meeting = await s.pm.browser.post(`${s.base}/meeting-series/${series.id}/meetings`, {
      title: 'Phase I ESA review',
      heldAt: '2026-11-20T01:00:00Z',
    });
    expect(meeting.statusCode).toBe(201);
    const meetingId = (meeting.json() as { meeting: { id: string } }).meeting.id;

    // Nova suggests the meeting for an item that has a meeting type... the ESA item is a checklist/inspection,
    // so give it a meeting type and look again.
    await s.pm.browser.patch(`${s.base}/project-plan/items/${esa.id}`, {
      types: ['checklist', 'meeting'],
      dueDate: '2020-01-01',
    });
    const insights = (await s.pm.browser.get(`${s.base}/project-plan/insights`)).json() as {
      overdue: Array<{ number: string }>;
      suggestedLinks: Array<{ number: string; link: { id: string; type: string } }>;
    };
    expect(insights.overdue.map((o) => o.number)).toContain(esa.number);
    const hit = insights.suggestedLinks.find((x) => x.number === esa.number);
    expect(hit?.link).toMatchObject({ type: 'meeting', id: meetingId });

    const options = (
      await s.pm.browser.get(`${s.base}/project-plan/items/${esa.id}/link-options?type=meeting`)
    ).json() as {
      data: Array<{ id: string }>;
    };
    expect(options.data[0]!.id).toBe(meetingId);
    const linked = await s.pm.browser.patch(`${s.base}/project-plan/items/${esa.id}`, {
      links: [{ type: 'meeting', id: meetingId }],
    });
    const link = (linked.json() as Plan).phases[1]!.items.find((i) => i.id === esa.id)!.links[0]!;
    expect(link).toMatchObject({ type: 'meeting', id: meetingId, status: 'draft' });
    expect(
      (
        await s.pm.browser.patch(`${s.base}/project-plan/items/${esa.id}`, {
          links: [{ type: 'meeting', id: 'rfi_00000000000000000000000000' }],
        })
      ).statusCode,
    ).toBe(422);

    const asked = await s.pm.browser.post(`${s.base}/project-plan/items/${esa.id}/requests`, {
      kind: 'photo',
      message: 'Site photos please',
    });
    expect(asked.statusCode).toBe(201);
    expect(
      (asked.json() as Plan).phases[1]!.items.find((i) => i.id === esa.id)!.requests[0]!.status,
    ).toBe('open');

    const summary = await s.pm.browser.post(
      `${s.base}/project-plan/phases/${plan.phases[1]!.id}/summary`,
    );
    expect(summary.json().text).toContain('overdue');
  });
});
