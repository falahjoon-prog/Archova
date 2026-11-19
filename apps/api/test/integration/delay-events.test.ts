import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDateOf } from '@archova/time';
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

const today = () => localDateOf(new Date(), 'Australia/Brisbane');

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builders`);
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return { pm, sm, sub, org, project, base };
}

/** A diary day with weather and a delay line the site manager marked as lost time. */
async function diaryDay(
  s: Awaited<ReturnType<typeof setup>>,
  day: string,
  weather: { rainfallMm: number } | null,
  delay: { type: string; description: string; hours: number } | null,
) {
  if (weather) {
    const res = await s.sm.browser.put(`${s.base}/diary/${day}`, { weatherOverride: weather });
    expect(res.statusCode, res.body).toBe(200);
  }
  if (delay) {
    const res = await s.sm.browser.post(`${s.base}/diary/${day}/delays`, delay);
    expect(res.statusCode, res.body).toBe(201);
  }
}

type Candidate = {
  key: string;
  kind: string;
  label: string;
  possibleEot: boolean;
  eventId: string | null;
};

describe('delay events and EOT claims (SCH-AC3..5)', () => {
  it('groups diary delays and rain days into an event, runs the clocks, drafts and records the claim', async () => {
    const s = await setup('eot-flow');
    const rainDay = addDays(today(), -3);
    const oldDay = addDays(today(), -20);
    await diaryDay(
      s,
      rainDay,
      { rainfallMm: 22 },
      { type: 'weather', description: 'Rain stopped the pour', hours: 4 },
    );
    await diaryDay(s, addDays(today(), -2), { rainfallMm: 3 }, null); // dry enough: not a rain day
    await diaryDay(s, oldDay, null, {
      type: 'client',
      description: 'Client held the finishes decision',
      hours: 8,
    });

    // Settings start as the AS 4000 defaults, unconfirmed.
    const defaults = (await s.pm.browser.get(`${s.base}/eot-settings`)).json();
    expect(defaults).toMatchObject({
      form: 'as4000',
      noticeDays: 14,
      claimDays: 28,
      confirmed: false,
      isDefault: true,
    });
    const saved = await s.pm.browser.put(`${s.base}/eot-settings`, {
      form: 'as4000',
      noticeDays: 7,
      claimDays: 21,
      dayBasis: 'calendar',
      noticeClause: 'cl 34.2',
      claimClause: 'cl 34.3',
      confirmed: true,
      rainThresholdMm: 10,
      wetDayAllowance: 1,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      confirmed: true,
      isDefault: false,
      noticeDays: 7,
      version: 1,
    });

    // The register offers the delays and the one rain day over the threshold.
    const cand = (await s.pm.browser.get(`${s.base}/delay-event-candidates`)).json();
    const rows: Candidate[] = cand.data;
    expect(rows.map((r) => r.kind).sort()).toEqual(['diary_delay', 'diary_delay', 'weather_day']);
    const rain = rows.find((r) => r.kind === 'weather_day')!;
    expect(rain.key).toBe(`weather:${rainDay}`);
    expect(rain.label).toContain('22 mm rain');
    expect(rain.possibleEot).toBe(false);
    const rainDelay = rows.find((r) => r.label === 'Rain stopped the pour')!;
    const oldDelay = rows.find((r) => r.label === 'Client held the finishes decision')!;
    expect(rainDelay.key).toMatch(/^diary:ddy_/);

    // Nova already flags the old client delay: it is marked possible EOT, in no event, and past a 7-day notice period.
    const before = (await s.pm.browser.get(`${s.base}/delay-event-insights`)).json();
    expect(before.flags[0]).toMatchObject({ kind: 'untracked_delay', severity: 'high' });
    expect(before.flags[0].message).toContain('Client held the finishes decision');
    expect(before.summary).toMatchObject({ events: 0, untrackedDelays: 2 });

    // Group the rain day and its delay line into one event.
    const created = await s.pm.browser.post(`${s.base}/delay-events`, {
      title: 'Wet weather, level 3 pour',
      cause: 'weather',
      startedOn: rainDay,
      endedOn: rainDay,
      affected: 'Level 3 slab',
      criticalPath: true,
      daysClaimed: 1,
      candidateKeys: [rain.key, rainDelay.key],
    });
    expect(created.statusCode, created.body).toBe(201);
    const event = created.json();
    expect(event).toMatchObject({
      number: 1,
      ref: 'EOT-001',
      status: 'draft',
      awareOn: rainDay,
      daysClaimed: 1,
      suggestedDays: 1,
      evidence: { items: 2, diaryHours: 4, rainDays: 1, rainMm: 22 },
    });
    expect(event.id).toMatch(/^dxe_/);
    // Notice period 7 days from the day the builder became aware: 4 days left.
    expect(event.noticeClock).toMatchObject({
      dueOn: addDays(rainDay, 7),
      daysLeft: 4,
      state: 'ok',
    });
    expect(event.claimClock).toMatchObject({ dueOn: addDays(rainDay, 21), overridden: false });

    // That evidence is spoken for: it drops off the register and cannot go into a second event.
    const after = (await s.pm.browser.get(`${s.base}/delay-event-candidates`)).json()
      .data as Candidate[];
    expect(after.map((r) => r.label)).toEqual(['Client held the finishes decision']);
    const all = (
      await s.pm.browser.get(`${s.base}/delay-event-candidates?includeAttached=true`)
    ).json().data as Candidate[];
    expect(all.filter((r) => r.eventId === event.id)).toHaveLength(2);
    const second = await s.pm.browser.post(`${s.base}/delay-events`, {
      title: 'Same rain again',
      cause: 'weather',
      startedOn: rainDay,
      candidateKeys: [rain.key],
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('delay_event.evidence_taken');
    expect(
      (
        await s.pm.browser.post(`${s.base}/delay-events`, {
          title: 'Gone',
          cause: 'other',
          startedOn: rainDay,
          candidateKeys: ['diary:ddy_00000000000000000000000000'],
        })
      ).json().code,
    ).toBe('delay_event.source_not_found');

    // A correspondence notice goes into the pack, and Nova drafts the notice from the lot.
    const type = (
      await s.pm.browser.post(`/v1/orgs/${s.org.id}/correspondence-types`, {
        templateKey: 'notice_of_delay',
      })
    ).json();
    const notice = (
      await s.pm.browser.post(`${s.base}/correspondence`, { typeId: type.id, eventDate: rainDay })
    ).json().item;
    const detail = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/evidence`, {
      correspondenceIds: [notice.id],
      notes: [
        {
          date: rainDay,
          label: 'Site manager phoned the superintendent',
          detail: 'Spoke at 8:15am',
        },
      ],
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(
      detail
        .json()
        .items.map((i: { kind: string }) => i.kind)
        .sort(),
    ).toEqual(['correspondence', 'diary_delay', 'note', 'weather_day']);
    const draft = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/drafts`, {
      kind: 'notice',
      senderName: 'Sam Site',
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json().subject).toBe('Notice of delay: Wet weather, level 3 pour (EOT-001)');
    expect(draft.json().body).toContain('Rain stopped the pour (4 h lost)');
    expect(draft.json().body).toContain('Clause: cl 34.2');
    expect(draft.json().body).toContain('Sam Site');
    expect(draft.json().warnings).toEqual([]);

    // Record the notice with the correspondence item, then the claim.
    const given = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
      action: 'give_notice',
      correspondenceId: notice.id,
    });
    expect(given.statusCode, given.body).toBe(200);
    expect(given.json()).toMatchObject({
      status: 'notice_given',
      noticeSentOn: today(),
      noticeClock: { state: 'met' },
    });
    expect(given.json().noticeRefLabel).toContain('NOD-001');
    expect(
      (
        await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
          action: 'give_notice',
        })
      ).json().code,
    ).toBe('delay_event.bad_state');
    expect(
      (
        await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
          action: 'record_assessment',
          daysGranted: 1,
        })
      ).statusCode,
    ).toBe(409);
    const claimDraft = (
      await s.pm.browser.post(`${s.base}/delay-events/${event.id}/drafts`, { kind: 'claim' })
    ).json();
    expect(claimDraft.body).toContain('Reference notice of delay: NOD-001');
    expect(claimDraft.body).toContain('Days claimed: 1');
    const claimed = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
      action: 'submit_claim',
      daysClaimed: 2,
    });
    expect(claimed.json()).toMatchObject({
      status: 'claimed',
      daysClaimed: 2,
      claimSentOn: today(),
    });
    const future = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
      action: 'record_assessment',
      daysGranted: 1,
      on: addDays(today(), 3),
    });
    expect(future.statusCode).toBe(422);
    const assessed = await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
      action: 'record_assessment',
      daysGranted: 1,
      note: 'Superintendent granted one wet day',
    });
    expect(assessed.json()).toMatchObject({ status: 'assessed', daysGranted: 1 });

    // Insights now count the claim and the wet day against the one-day allowance.
    const insights = (await s.pm.browser.get(`${s.base}/delay-event-insights`)).json();
    expect(insights.summary).toMatchObject({
      events: 1,
      daysClaimed: 2,
      daysGranted: 1,
      wetDays: 1,
      wetDayAllowance: 1,
    });

    // Closed events are read-only until reopened; history records every step.
    await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, { action: 'close' });
    expect(
      (await s.pm.browser.patch(`${s.base}/delay-events/${event.id}`, { title: 'Renamed' })).json()
        .code,
    ).toBe('delay_event.bad_state');
    expect(
      (
        await s.pm.browser.post(`${s.base}/delay-events/${event.id}/transitions`, {
          action: 'reopen',
        })
      ).json().status,
    ).toBe('assessed');
    const full = (await s.pm.browser.get(`${s.base}/delay-events/${event.id}`)).json();
    expect(full.history.map((h: { kind: string }) => h.kind)).toEqual([
      'created',
      'evidence_added',
      'evidence_added',
      'drafted',
      'notice_given',
      'drafted',
      'claim_submitted',
      'assessed',
      'closed',
      'reopened',
    ]);

    // Evidence can be taken out again and the source goes back on the register.
    const noteItem = full.items.find((i: { kind: string }) => i.kind === 'note');
    expect(
      (await s.pm.browser.del(`${s.base}/delay-events/${event.id}/evidence/${noteItem.id}`))
        .statusCode,
    ).toBe(204);
    const weatherItem = full.items.find((i: { kind: string }) => i.kind === 'weather_day');
    await s.pm.browser.del(`${s.base}/delay-events/${event.id}/evidence/${weatherItem.id}`);
    const back = (await s.pm.browser.get(`${s.base}/delay-event-candidates`)).json()
      .data as Candidate[];
    expect(back.map((r) => r.key)).toContain(rain.key);
    void oldDelay;
  });

  it('counts the notice period from a person-set deadline and with a changed contract period', async () => {
    const s = await setup('eot-clock');
    const day = addDays(today(), -10);
    const created = await s.pm.browser.post(`${s.base}/delay-events`, {
      title: 'Late design information',
      cause: 'design',
      startedOn: day,
      noticeDueOn: addDays(today(), 2),
    });
    expect(created.json().noticeClock).toMatchObject({
      daysLeft: 2,
      state: 'due_soon',
      overridden: true,
    });
    // Default periods: 14 days notice from 10 days ago leaves 4, but the override wins; claim is 28 from aware.
    expect(created.json().claimClock).toMatchObject({ dueOn: addDays(day, 28), overridden: false });
    const f = (await s.pm.browser.get(`${s.base}/delay-event-insights`))
      .json()
      .flags.map((x: { kind: string }) => x.kind);
    expect(f).toEqual(
      expect.arrayContaining(['notice_due_soon', 'no_evidence', 'periods_unconfirmed']),
    );
    expect(
      (
        await s.pm.browser.post(`${s.base}/delay-events`, {
          title: 'Backwards',
          cause: 'other',
          startedOn: today(),
          endedOn: day,
        })
      ).statusCode,
    ).toBe(422);
  });

  it('is for builder staff: a subcontractor sees nothing and can change nothing', async () => {
    const s = await setup('eot-sub');
    for (const path of [
      'eot-settings',
      'delay-events',
      'delay-event-candidates',
      'delay-event-insights',
    ])
      expect((await s.sub.browser.get(`${s.base}/${path}`)).statusCode).toBe(403);
    expect(
      (
        await s.sub.browser.post(`${s.base}/delay-events`, {
          title: 'x',
          cause: 'other',
          startedOn: today(),
        })
      ).statusCode,
    ).toBe(403);
    // A site manager can read and group delays too.
    expect((await s.sm.browser.get(`${s.base}/delay-events`)).statusCode).toBe(200);
  });
});
