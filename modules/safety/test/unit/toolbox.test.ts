import { describe, expect, it } from 'vitest';
import {
  closeBlockers,
  personKey,
  repeatSignatureFlags,
  suggestTopics,
  toolboxLabel,
} from '../../src/domain/toolbox';

const row = (id: string, name: string, sha: string | null, talkId = 't1') => ({
  id,
  talkId,
  personKey: personKey(name, null),
  signatureSha256: sha,
});

describe('toolbox rules', () => {
  it('numbers talks TBT-0001', () => expect(toolboxLabel(7)).toBe('TBT-0007'));

  it('blocks closing an empty grid or one with unsigned rows', () => {
    expect(closeBlockers([])).toHaveLength(1);
    expect(closeBlockers([{ signedAt: new Date() }, { signedAt: null }])[0]).toMatch(
      /1 person has/,
    );
    expect(closeBlockers([{ signedAt: new Date() }])).toEqual([]);
  });

  it('flags one image on rows for different people, not the same person twice', () => {
    const flags = repeatSignatureFlags(
      [row('a', 'Sam', 'h1'), row('b', 'Lee', 'h1'), row('c', 'Kim', 'h2')],
      [],
    );
    expect(flags.get('a')).toEqual(['shared_between_people']);
    expect(flags.get('b')).toEqual(['shared_between_people']);
    expect(flags.has('c')).toBe(false);
  });

  it('flags a person whose image matches one they signed with before', () => {
    const flags = repeatSignatureFlags(
      [row('a', 'Sam', 'h1'), row('b', 'Lee', 'h9')],
      [row('z', ' sam ', 'h1', 't0'), row('y', 'Lee', 'h8', 't0')],
    );
    expect(flags.get('a')).toEqual(['reused_from_earlier_talk']);
    expect(flags.has('b')).toBe(false);
  });

  it('ignores rows with no signature image', () => {
    expect(repeatSignatureFlags([row('a', 'Sam', null), row('b', 'Lee', null)], []).size).toBe(0);
  });

  const now = new Date('2026-11-08T00:00:00Z');
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const topics = [
    { id: 'falls', title: 'Falls', hrcwCategory: 'fall_2m', category: 'hazard' },
    { id: 'old', title: 'Manual handling', hrcwCategory: null, category: 'general' },
    { id: 'new', title: 'Heat', hrcwCategory: null, category: 'wellbeing' },
  ];

  it('suggests from recent incidents, SWMS in force, then stale or never-run topics', () => {
    const out = suggestTopics({
      topics,
      lastRun: new Map([
        ['falls', days(40)],
        ['old', days(90)],
      ]),
      recentIncidentTypes: [{ type: 'near_miss', count: 2 }],
      swmsCategories: ['fall_2m', 'fall_2m', 'asbestos'],
      now,
    });
    expect(out.map((s) => [s.reason, s.title])).toEqual([
      ['recent_incident', 'Near misses: what we saw and what we changed'],
      ['swms_in_force', 'Falls'],
      ['swms_in_force', 'Asbestos: stop, report and keep clear'],
      ['never_run', 'Heat'],
      ['not_run_recently', 'Manual handling'],
    ]);
    expect(out[0]!.because).toMatch(/2 near miss reports/);
    expect(out[1]!.topicId).toBe('falls');
    expect(out[2]!.topicId).toBeNull();
  });

  it('does not repeat a topic that ran in the last 30 days', () => {
    const out = suggestTopics({
      topics,
      lastRun: new Map([
        ['falls', days(5)],
        ['old', days(10)],
        ['new', days(10)],
      ]),
      recentIncidentTypes: [],
      swmsCategories: ['fall_2m'],
      now,
    });
    expect(out).toEqual([]);
  });
});
