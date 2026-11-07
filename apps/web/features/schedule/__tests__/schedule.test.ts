import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatChangeValue, formatLdRate, pcCountdown, timeLost } from '../lib/labels';
import { draftOf, movesTarget, toPatch } from '../lib/patch';
import type { KeyDates } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const { createScheduleApi } = await import('../data/api');

const dates = (over: Partial<KeyDates> = {}): KeyDates => ({
  projectId: 'prj_1',
  possessionDate: '2027-01-04',
  pcTarget: '2027-03-18',
  pcActual: null,
  dlpEnd: '2028-03-18',
  ldRatePerDay: '4500.00',
  currency: 'AUD',
  sections: [{ id: 's1', name: 'Stage 1', targetDate: '2027-02-18', actualDate: null }],
  daysToPc: 84,
  daysToDlpEnd: 449,
  version: 2,
  updatedAt: '2027-01-05T00:00:00Z',
  ...over,
});

describe('labels', () => {
  it('words the PC countdown for before, on, after the target and once reached', () => {
    expect(pcCountdown(dates())).toBe('PC in 84 days (target 18 Mar 2027)');
    expect(pcCountdown(dates({ daysToPc: 1 }))).toBe('PC in 1 day (target 18 Mar 2027)');
    expect(pcCountdown(dates({ daysToPc: 0 }))).toBe('PC is due today (target 18 Mar 2027)');
    expect(pcCountdown(dates({ daysToPc: -3 }))).toBe('PC is 3 days past target (18 Mar 2027)');
    expect(pcCountdown(dates({ pcActual: '2027-03-10', daysToPc: null }))).toBe(
      'PC reached 10 Mar 2027',
    );
    expect(pcCountdown(dates({ pcTarget: null, daysToPc: null }))).toBeNull();
  });

  it('shows money and history values the way people read them', () => {
    expect(formatLdRate('4500.00', 'AUD')).toBe('$4,500');
    expect(formatLdRate('4500.50', 'AUD')).toBe('$4,500.50');
    expect(formatLdRate(null, 'AUD')).toBeNull();
    expect(formatChangeValue('pcTarget', '2027-03-18')).toBe('18 Mar 2027');
    expect(formatChangeValue('pcTarget', null)).toBe('not set');
    expect(formatChangeValue('sectionAdded', 'Stage 1')).toBe('Stage 1');
    expect(timeLost({ hours: 3, days: null })).toBe('3 h');
    expect(timeLost({ hours: null, days: 1 })).toBe('1 day');
  });
});

describe('key date edits', () => {
  it('sends only what changed, and nothing for an untouched form', () => {
    const k = dates();
    expect(toPatch(k, draftOf(k))).toEqual({});
    const d = { ...draftOf(k), pcActual: '2027-03-10', ldRatePerDay: '' };
    expect(toPatch(k, d)).toEqual({ pcActual: '2027-03-10', ldRatePerDay: null });
  });

  it('asks for a reason only when a target that was set moves', () => {
    const k = dates();
    expect(movesTarget(k, draftOf(k))).toBe(false);
    expect(movesTarget(k, { ...draftOf(k), pcTarget: '2027-04-01' })).toBe(true);
    expect(movesTarget(k, { ...draftOf(k), pcActual: '2027-03-10' })).toBe(false);
    const moved = draftOf(k);
    moved.sections[0]!.targetDate = '2027-03-01';
    expect(movesTarget(k, moved)).toBe(true);
    // A first target, or a new section, needs none.
    expect(movesTarget(dates({ pcTarget: null }), { ...draftOf(k), pcTarget: '2027-04-01' })).toBe(
      false,
    );
    const added = draftOf(k);
    added.sections.push({ name: 'Stage 2', targetDate: '2027-03-18', actualDate: '' });
    expect(movesTarget(k, added)).toBe(false);
  });

  it('sends the whole section list with ids when a section changes, plus the reason and note', () => {
    const k = dates();
    const d = { ...draftOf(k), reason: 'eot_granted' as const, note: ' EOT 3 ' };
    d.sections[0]!.targetDate = '2027-03-01';
    d.sections.push({ name: 'Stage 2', targetDate: '', actualDate: '' });
    expect(toPatch(k, d)).toEqual({
      sections: [
        { id: 's1', name: 'Stage 1', targetDate: '2027-03-01', actualDate: null },
        { name: 'Stage 2', targetDate: null, actualDate: null },
      ],
      reason: 'eot_granted',
      note: 'EOT 3',
    });
  });
});

describe('schedule API', () => {
  beforeEach(() => fake.reset());

  it('saves with the version as If-Match', async () => {
    fake.on('PATCH', '/v1/orgs/{orgId}/projects/{projectId}/key-dates', () =>
      dates({ version: 3 }),
    );
    const res = await createScheduleApi('org_1').updateKeyDates('prj_1', 2, {
      pcActual: '2027-03-10',
    });
    expect(res.version).toBe(3);
    const call = fake.calls.at(-1)!;
    expect(call.init.params?.header).toEqual({ 'If-Match': '"2"' });
    expect(call.init.body).toEqual({ pcActual: '2027-03-10' });
  });

  it('sends only the register filters that are set', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/delay-register', () => ({
      data: [],
      totals: { rows: 0, possibleEotRows: 0, diaryHours: 0, rfiDays: 0 },
      truncated: false,
    }));
    await createScheduleApi('org_1').delayRegister('prj_1', { cause: 'weather', eotOnly: true });
    expect(fake.calls.at(-1)!.init.params?.query).toEqual({ cause: 'weather', eotOnly: 'true' });
    await createScheduleApi('org_1').delayRegister('prj_1', {});
    expect(fake.calls.at(-1)!.init.params?.query).toEqual({});
  });
});
