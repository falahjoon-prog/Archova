import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  TITLE_MAX,
  cleanBody,
  cleanTitle,
  dueAt,
  previewOf,
  recentlyNudged,
  resolveAudience,
  unreadFlags,
  type MemberRef,
} from '../../src/domain/announcements';

const m = (userId: string, companyId: string, isExternal = false): MemberRef => ({
  userId,
  companyId,
  isExternal,
});
const members = [
  m('pm', 'builder'),
  m('sm', 'builder'),
  m('steel', 'steelco', true),
  m('tile', 'tileco', true),
];

describe('announcement text rules', () => {
  it('tidies a title and refuses an empty or over-long one', () => {
    expect(cleanTitle('  Pour   moved \n')).toBe('Pour moved');
    expect(cleanTitle('   ')).toBeNull();
    expect(cleanTitle('x'.repeat(TITLE_MAX + 1))).toBeNull();
  });
  it('keeps line breaks in a body', () => {
    expect(cleanBody('\n a\nb \n')).toBe('a\nb');
    expect(cleanBody('y'.repeat(BODY_MAX + 1))).toBeNull();
  });
  it('shortens a preview to one line', () => {
    expect(previewOf('one\ntwo')).toBe('one two');
    expect(previewOf('word '.repeat(80), 40).endsWith('…')).toBe(true);
  });
});

describe('audience', () => {
  it('"all" is everyone but the sender, outside members included', () => {
    expect(resolveAudience(members, { kind: 'all' }, 'pm').sort()).toEqual(['sm', 'steel', 'tile']);
  });
  it('a group is the named companies plus named people, once each', () => {
    const got = resolveAudience(
      members,
      { kind: 'group', companyIds: ['steelco'], userIds: ['steel', 'sm', 'pm'] },
      'pm',
    );
    expect(got.sort()).toEqual(['sm', 'steel']);
  });
  it('an empty group reaches nobody', () => {
    expect(resolveAudience(members, { kind: 'group', companyIds: [], userIds: [] }, 'pm')).toEqual(
      [],
    );
  });
});

describe('Nova unread flags', () => {
  const created = new Date('2026-11-07T00:00:00Z');
  const rows = [
    { userId: 'a', isKey: true, readAt: null, nudgedAt: null },
    { userId: 'b', isKey: true, readAt: new Date('2026-11-07T02:00:00Z'), nudgedAt: null },
    { userId: 'c', isKey: false, readAt: null, nudgedAt: null },
  ];
  it('flags nothing before the read-by time or without one', () => {
    expect(unreadFlags(rows, created, 24, new Date('2026-11-07T23:00:00Z'))).toEqual([]);
    expect(unreadFlags(rows, created, null, new Date('2026-12-01T00:00:00Z'))).toEqual([]);
  });
  it('flags only unread key people once the window has passed', () => {
    const flags = unreadFlags(rows, created, 24, new Date('2026-11-08T06:30:00Z'));
    expect(flags).toEqual([{ userId: 'a', isKey: true, hoursOverdue: 6, nudgedAt: null }]);
  });
  it('counts every unread recipient when no key people were named', () => {
    const none = rows.map((r) => ({ ...r, isKey: false }));
    const flags = unreadFlags(none, created, 1, new Date('2026-11-07T05:00:00Z'));
    expect(flags.map((f) => f.userId)).toEqual(['a', 'c']);
  });
  it('works out the deadline and the reminder cooldown', () => {
    expect(dueAt(created, 48)?.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(dueAt(created, null)).toBeNull();
    const now = new Date('2026-11-07T10:00:00Z');
    expect(recentlyNudged(new Date('2026-11-07T07:00:00Z'), now)).toBe(true);
    expect(recentlyNudged(new Date('2026-11-07T05:00:00Z'), now)).toBe(false);
    expect(recentlyNudged(null, now)).toBe(false);
  });
});
