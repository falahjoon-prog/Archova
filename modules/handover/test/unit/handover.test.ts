import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@archova/time';
import {
  DEFAULT_TEMPLATE,
  handoverFlags,
  handoverState,
  handoverTransition,
  readyToIssue,
  summarise,
  type FlagItem,
  type HandoverStatus,
  type Signals,
} from '../../src/domain/handover';

const day = (d: string) => d as LocalDate;
const today = day('2026-11-18');
const none: Signals = { openDefects: null, warrantyItems: null, occupationCertificate: null };

const item = (over: Partial<FlagItem> = {}): FlagItem => ({
  id: 'i1',
  number: 1,
  title: 'O&M manual: electrical',
  category: 'om_manual',
  required: true,
  status: 'outstanding',
  dueOn: null,
  responsibleCompanyId: 'c1',
  fileCount: 0,
  receivedOn: null,
  ...over,
});

describe('standard list', () => {
  it('has unique titles and covers every close-out category the client expects', () => {
    const titles = DEFAULT_TEMPLATE.map((t) => t.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    const cats = new Set(DEFAULT_TEMPLATE.map((t) => t.category));
    for (const c of [
      'as_built',
      'om_manual',
      'warranty',
      'certificate',
      'defect_signoff',
      'keys_access',
    ])
      expect(cats.has(c as never)).toBe(true);
  });
});

describe('handoverTransition', () => {
  it('walks outstanding to requested to received to approved', () => {
    expect(handoverTransition('outstanding', 'request')).toEqual({ ok: true, to: 'requested' });
    expect(handoverTransition('requested', 'receive', { fileCount: 1 })).toEqual({
      ok: true,
      to: 'received',
    });
    expect(handoverTransition('received', 'approve')).toEqual({ ok: true, to: 'approved' });
  });
  it('lets a file arrive without a request first', () => {
    expect(handoverTransition('outstanding', 'receive', { fileCount: 2 }).ok).toBe(true);
  });
  it('refuses to receive without a file', () => {
    expect(handoverTransition('requested', 'receive', { fileCount: 0 }).ok).toBe(false);
  });
  it('only approves what was received', () => {
    for (const s of ['outstanding', 'requested', 'approved', 'not_applicable'] as HandoverStatus[])
      expect(handoverTransition(s, 'approve').ok).toBe(false);
  });
  it('needs a reason to send back or mark not applicable', () => {
    expect(handoverTransition('received', 'reject').ok).toBe(false);
    expect(handoverTransition('received', 'reject', { note: ' ' }).ok).toBe(false);
    expect(handoverTransition('received', 'reject', { note: 'Missing page 4' })).toEqual({
      ok: true,
      to: 'requested',
    });
    expect(handoverTransition('outstanding', 'markNotApplicable').ok).toBe(false);
    expect(
      handoverTransition('outstanding', 'markNotApplicable', { note: 'No gas supply' }).ok,
    ).toBe(true);
  });
  it('makes an approved item be reopened before it can be marked not applicable', () => {
    expect(handoverTransition('approved', 'markNotApplicable', { note: 'x' }).ok).toBe(false);
    expect(handoverTransition('approved', 'reopen')).toEqual({ ok: true, to: 'outstanding' });
    expect(handoverTransition('outstanding', 'reopen').ok).toBe(false);
  });
});

describe('handoverState', () => {
  it('is overdue only for unfinished items past their due date', () => {
    expect(handoverState({ status: 'outstanding', dueOn: '2026-11-17' }, today)).toBe('overdue');
    expect(handoverState({ status: 'requested', dueOn: '2026-11-17' }, today)).toBe('overdue');
    expect(handoverState({ status: 'outstanding', dueOn: '2026-11-18' }, today)).toBe(
      'outstanding',
    );
    expect(handoverState({ status: 'received', dueOn: '2026-11-01' }, today)).toBe('received');
    expect(handoverState({ status: 'approved', dueOn: '2026-11-01' }, today)).toBe('approved');
    expect(handoverState({ status: 'outstanding', dueOn: null }, today)).toBe('outstanding');
  });
});

describe('summarise and readyToIssue', () => {
  const row = (
    status: HandoverStatus,
    required = true,
    category: 'warranty' | 'certificate' = 'warranty',
  ) => ({
    category,
    required,
    status,
    dueOn: null,
  });
  it('counts progress over required items only', () => {
    const s = summarise(
      [
        row('approved'),
        row('not_applicable'),
        row('outstanding'),
        row('received'),
        row('outstanding', false, 'certificate'),
      ],
      today,
    );
    expect(s).toMatchObject({
      total: 5,
      required: 4,
      requiredComplete: 2,
      complete: 2,
      received: 1,
      percentComplete: 50,
    });
    expect(s.byCategory.find((c) => c.category === 'warranty')).toMatchObject({
      total: 4,
      requiredOutstanding: 2,
    });
    expect(readyToIssue(s)).toBe(false);
  });
  it('is ready when every required item is approved or not applicable', () => {
    const s = summarise([row('approved'), row('not_applicable'), row('outstanding', false)], today);
    expect(s.percentComplete).toBe(100);
    expect(readyToIssue(s)).toBe(true);
  });
  it('is not ready with an empty checklist', () => {
    const s = summarise([], today);
    expect(s.percentComplete).toBe(100);
    expect(readyToIssue(s)).toBe(false);
  });
});

describe('handoverFlags', () => {
  it('suggests the standard list when there are no items', () => {
    expect(handoverFlags([], none, today).map((f) => f.kind)).toEqual(['empty_checklist']);
  });
  it('flags overdue required items as high and optional ones as warn', () => {
    const f = handoverFlags(
      [
        item({ dueOn: '2026-11-10' }),
        item({ id: 'i2', number: 2, required: false, dueOn: '2026-11-10' }),
      ],
      none,
      today,
    ).filter((x) => x.kind === 'overdue');
    expect(f.map((x) => x.severity)).toEqual(['high', 'warn']);
    expect(f[0]!.detail).toBe('Due 2026-11-10, 8 days ago.');
  });
  it('flags a required item nobody is responsible for, but not once it is received or done', () => {
    const kinds = (i: Partial<FlagItem>) =>
      handoverFlags([item({ responsibleCompanyId: null, ...i })], none, today).map((f) => f.kind);
    expect(kinds({})).toContain('no_responsible');
    expect(kinds({ status: 'received', receivedOn: '2026-11-17' })).not.toContain('no_responsible');
    expect(kinds({ status: 'approved' })).toEqual([]);
  });
  it('mentions received items that have waited a week for approval', () => {
    const f = (receivedOn: string) =>
      handoverFlags([item({ status: 'received', receivedOn })], none, today).map((x) => x.kind);
    expect(f('2026-11-11')).toContain('awaiting_approval');
    expect(f('2026-11-12')).not.toContain('awaiting_approval');
  });
  it('uses what other modules know, and stays silent when it cannot see them', () => {
    const items = [
      item({ category: 'warranty', status: 'approved' }),
      item({ id: 'i2', number: 2, category: 'certificate', title: 'OC' }),
    ];
    const kinds = (s: Signals) => handoverFlags(items, s, today).map((f) => f.kind);
    expect(kinds(none)).toEqual([]);
    expect(kinds({ openDefects: 3, warrantyItems: 0, occupationCertificate: 'none' })).toEqual(
      expect.arrayContaining([
        'open_defects',
        'warranty_register_empty',
        'no_occupation_certificate',
      ]),
    );
    expect(kinds({ openDefects: 0, warrantyItems: 4, occupationCertificate: 'present' })).toEqual(
      [],
    );
  });
  it('does not ask for a warranty register when every warranty item is not applicable', () => {
    const f = handoverFlags(
      [item({ category: 'warranty', status: 'not_applicable' })],
      { openDefects: 0, warrantyItems: 0, occupationCertificate: 'present' },
      today,
    );
    expect(f).toEqual([]);
  });
  it('orders the most urgent first', () => {
    const f = handoverFlags(
      [item({ dueOn: '2026-11-01' })],
      { openDefects: 2, warrantyItems: null, occupationCertificate: 'none' },
      today,
    );
    const rank = { high: 0, warn: 1, info: 2 };
    expect(f.map((x) => rank[x.severity])).toEqual([...f.map((x) => rank[x.severity])].sort());
  });
});
