import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FAKE_RESPONDERS } from '@archova/mod-ai';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// F7 (ai/01): "Draft with Nova" on a meeting, through the real meetings and ai modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const calls = () => t.ai.calls.filter((c) => c.task === 'minutes.extract');

const NOTES = [
  'Decision: Level 4 slab pour moved to Thursday 15 October.',
  'Action: Sam Sparky to deliver the switchboard drawings by Friday.',
  'Action: Confirm the hoarding permit renewal.',
  'Info: The crane inspection certificate is current.',
].join('\n');

async function setup() {
  const pm = await signUp(t.app, 'mnv-pm');
  const sub = await signUp(t.app, 'mnv-sub');
  const org = await createOrg(pm.browser, 'Nova Minutes Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  const series = (
    await pm.browser.post(`${base}/meeting-series`, {
      name: 'Site coordination',
      template: 'site_coordination',
      defaultAttendees: [
        { name: 'Dana PM', companyName: 'Nova Minutes Builder', role: 'PM' },
        { name: 'Sam Sparky', companyName: 'Sparky' },
      ],
    })
  ).json();
  const meeting = (
    await pm.browser.post(`${base}/meeting-series/${series.id}/meetings`, {
      heldAt: '2030-03-04T22:00:00Z',
    })
  ).json();
  return { pm, sub, org, project, base, meeting };
}

describe('Nova minutes drafting route (F7)', () => {
  it('proposes quoted items for the meeting, caches the same notes, and costs 1.5 credits', async () => {
    const s = await setup();
    const url = `${s.base}/meetings/${s.meeting.meeting.id}/nova-minutes`;
    const before = calls().length;

    const first = await s.pm.browser.post(url, { notes: NOTES });
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a).toMatchObject({ task: 'minutes.extract', status: 'pending', targetType: 'project' });
    expect(a.payload.meetingId).toBe(s.meeting.meeting.id);
    const items = a.payload.items as Array<{
      kind: string;
      text: string;
      quote: string;
      sectionId: string | null;
      attendeeId: string | null;
      dueDate: string | null;
    }>;
    expect(items.map((i) => i.kind)).toEqual(['decision', 'action', 'action', 'information']);
    // Every item quotes the notes, and ids are public ids.
    for (const i of items) expect(NOTES).toContain(i.quote);
    const sam = items[1]!;
    expect(sam.attendeeId).toMatch(/^mat_/);
    expect(sam.attendeeId).toBe(
      s.meeting.attendees.find((x: { name: string }) => x.name === 'Sam Sparky').id,
    );
    // 22:00Z on 4 March is Tuesday 5 March in Brisbane, so "by Friday" is the 8th.
    expect(sam.dueDate).toBe('2030-03-08');
    // The notes name nobody for the permit action, so it has no owner and no date.
    expect(items[2]).toMatchObject({ attendeeId: null, dueDate: null });
    expect(calls()).toHaveLength(before + 1);

    // The same notes are free; changed notes are a new draft.
    const again = await s.pm.browser.post(url, { notes: NOTES });
    expect(again.json().id).toBe(a.id);
    expect(calls()).toHaveLength(before + 1);
    const changed = await s.pm.browser.post(url, {
      notes: `${NOTES}\nInfo: Lift arrives next month.`,
    });
    expect(changed.json().id).not.toBe(a.id);
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'minutes', credits: 3, runs: 2 });

    // Nova wrote nothing into the minutes.
    const detail = (await s.pm.browser.get(`${s.base}/meetings/${s.meeting.meeting.id}`)).json();
    expect(detail.sections.flatMap((x: { items: unknown[] }) => x.items)).toHaveLength(0);

    // Only the asker can see or decide it.
    const list = (await s.pm.browser.get(`${s.base}/ai/suggestions?task=minutes.extract`)).json();
    expect(list.data.map((x: { id: string }) => x.id)).toContain(a.id);
    const decided = await s.pm.browser.post(`${s.base}/ai/suggestions/${a.id}/decision`, {
      decision: 'accepted',
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe('accepted');
  });

  it('drops items the notes do not back, and refuses short notes and people who cannot write', async () => {
    const s = await setup();
    const url = `${s.base}/meetings/${s.meeting.meeting.id}/nova-minutes`;
    t.ai.on('minutes.extract', () => ({
      output: {
        items: [
          {
            kind: 'action',
            sectionId: null,
            text: 'Pay the invoice',
            quote: 'Pay the invoice by Friday',
            ownerId: 'a2',
            dueDate: '2030-03-08',
          },
          {
            kind: 'action',
            sectionId: 's1',
            text: 'Confirm the permit',
            quote: 'Confirm the hoarding permit renewal',
            ownerId: 'a2',
            dueDate: '2030-03-08',
          },
        ],
      },
    }));
    try {
      const r = await s.pm.browser.post(url, { notes: NOTES });
      expect(r.statusCode).toBe(200);
      const p = r.json().payload;
      expect(p.dropped).toBe(1);
      expect(p.items).toHaveLength(1);
      // Sam is not named in the permit line, and the line gives no date.
      expect(p.items[0]).toMatchObject({ attendeeId: null, dueDate: null });
      expect(p.items[0].sectionId).toMatch(/^msc_/);
    } finally {
      t.ai.on('minutes.extract', DEFAULT_FAKE_RESPONDERS['minutes.extract']!);
    }

    expect((await s.pm.browser.post(url, { notes: 'too short' })).json().code).toBe(
      'ai.minutes.nothing_to_extract',
    );
    expect((await s.sub.browser.post(url, { notes: NOTES })).statusCode).toBeGreaterThanOrEqual(
      403,
    );
    const bad = await s.pm.browser.post(
      `${s.base}/meetings/mtg_00000000000000000000000000/nova-minutes`,
      {
        notes: NOTES,
      },
    );
    expect(bad.statusCode).toBe(404);
  });
});
