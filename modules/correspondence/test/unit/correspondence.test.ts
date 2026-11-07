import { describe, expect, it } from 'vitest';
import {
  auDate,
  canBePrivate,
  canClose,
  checkFieldDefs,
  diffFieldValues,
  diffItem,
  mergeFieldValues,
  missingRequiredFields,
  canEditItem,
  canRespondAs,
  canSeeItem,
  canVoid,
  canWriteDraft,
  renderTemplate,
  sentInTime,
  timeBarDate,
  timeBarState,
} from '../../src/domain/correspondence';
import { TYPE_TEMPLATES } from '../../src/domain/templates';

describe('time bars (SCH-AC4)', () => {
  it('adds the notice period to the event in calendar days', () => {
    expect(timeBarDate('2027-03-01', 14)).toBe('2027-03-15');
    expect(timeBarDate(null, 14)).toBeNull();
    expect(timeBarDate('2027-03-01', null)).toBeNull();
  });

  it('warns at 3 business days, goes red at 1 and is overdue after the date', () => {
    // 2027-03-18 is a Thursday: 3 business days before is Monday 15th, 1 before is Wednesday 17th.
    const d = { status: 'draft' as const, timeBarDate: '2027-03-18' };
    expect(timeBarState(d, '2027-03-12')).toBe('ok');
    expect(timeBarState(d, '2027-03-15')).toBe('amber');
    expect(timeBarState(d, '2027-03-17')).toBe('red');
    expect(timeBarState(d, '2027-03-18')).toBe('red');
    expect(timeBarState(d, '2027-03-19')).toBe('overdue');
  });

  it('stops counting once the notice is sent, and says whether it was in time', () => {
    expect(timeBarState({ status: 'sent', timeBarDate: '2027-03-18' }, '2027-04-01')).toBe('none');
    expect(sentInTime({ sentLocalDate: '2027-03-18', timeBarDate: '2027-03-18' })).toBe(true);
    expect(sentInTime({ sentLocalDate: '2027-03-19', timeBarDate: '2027-03-18' })).toBe(false);
    expect(sentInTime({ sentLocalDate: '2027-03-19', timeBarDate: null })).toBeNull();
  });
});

describe('lifecycle', () => {
  it('only drafts are editable; sent evidential notices cannot be voided', () => {
    expect(canEditItem('draft')).toBe(true);
    expect(canEditItem('sent')).toBe(false);
    expect(canVoid('draft', true)).toBe(true);
    expect(canVoid('sent', true)).toBe(false);
    expect(canVoid('sent', false)).toBe(true);
    expect(canVoid('closed', false)).toBe(false);
    expect(canClose('responded')).toBe(true);
    expect(canClose('draft')).toBe(false);
  });
});

describe('visibility', () => {
  const item = {
    status: 'sent' as const,
    createdBy: 'u-author',
    fromCompanyId: 'c-builder',
    toCompanyIds: ['c-steel'],
  };
  const sub = (companyId: string | null, userId = 'u-x') => ({
    userId,
    companyId,
    isInternal: false,
    isAdmin: false,
  });

  it('shows a sent item to the sending and receiving companies only', () => {
    expect(canSeeItem(item, sub('c-steel'))).toBe(true);
    expect(canSeeItem(item, sub('c-builder'))).toBe(true);
    expect(canSeeItem(item, sub('c-other'))).toBe(false);
    expect(canSeeItem(item, sub(null))).toBe(false);
    expect(
      canSeeItem(item, { userId: 'u-y', companyId: null, isInternal: true, isAdmin: false }),
    ).toBe(true);
  });

  it('keeps a draft with its author', () => {
    const draft = { ...item, status: 'draft' as const };
    expect(canSeeItem(draft, sub('c-steel'))).toBe(false);
    expect(canSeeItem(draft, sub(null, 'u-author'))).toBe(true);
    // Other staff don't see or write it; an admin does.
    const staff = { userId: 'u-staff', companyId: 'c-builder', isInternal: true, isAdmin: false };
    expect(canSeeItem(draft, staff)).toBe(false);
    expect(canWriteDraft(draft, staff)).toBe(false);
    expect(canSeeItem(draft, { ...staff, isAdmin: true })).toBe(true);
    expect(canWriteDraft(draft, { ...staff, isAdmin: true })).toBe(true);
    expect(canWriteDraft(draft, { ...staff, userId: 'u-author' })).toBe(true);
    // An outside user is never treated as an admin, even if their template grants admin on the tool.
    const outsider = { userId: 'u-out', companyId: 'c-other', isInternal: false, isAdmin: true };
    expect(canSeeItem(draft, outsider)).toBe(false);
    expect(canSeeItem({ ...item, status: 'sent' }, outsider)).toBe(false);
    expect(canWriteDraft(draft, outsider)).toBe(false);
  });

  it('lets only the companies on the item respond', () => {
    expect(canRespondAs(item, sub('c-steel'))).toBe(true);
    expect(canRespondAs(item, sub('c-other'))).toBe(false);
  });
});

describe('templates', () => {
  it('fills known tokens and leaves unknown ones visible', () => {
    expect(
      renderTemplate('{{number}} on {{ date }} {{nope}}', {
        number: 'NOD-001',
        date: '18/03/2027',
      }),
    ).toBe('NOD-001 on 18/03/2027 {{nope}}');
    expect(auDate('2027-03-18')).toBe('18/03/2027');
  });

  it('ships valid, unique AU notice templates', () => {
    const keys = TYPE_TEMPLATES.map((t) => t.key);
    const prefixes = TYPE_TEMPLATES.map((t) => t.prefix);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const t of TYPE_TEMPLATES) expect(t.prefix).toMatch(/^[A-Z]{1,6}$/);
    const nod = TYPE_TEMPLATES.find((t) => t.key === 'notice_of_delay')!;
    expect(nod.isEvidential).toBe(true);
    expect(nod.timeBarDays).not.toBeNull();
  });
});

describe('private items', () => {
  const item = {
    status: 'sent' as const,
    createdBy: 'author',
    fromCompanyId: 'a',
    toCompanyIds: ['b'],
    isPrivate: true,
    accessUserIds: ['listed'],
  };
  const viewer = (userId: string, o: object = {}) => ({
    userId,
    companyId: 'b',
    isInternal: false,
    isAdmin: false,
    ...o,
  });

  it('shows a private item only to its author, admins and the list', () => {
    expect(canSeeItem(item, viewer('author', { isInternal: true }))).toBe(true);
    expect(canSeeItem(item, viewer('boss', { isInternal: true, isAdmin: true }))).toBe(true);
    expect(canSeeItem(item, viewer('listed'))).toBe(true);
    // Not the receiving company, and not other staff.
    expect(canSeeItem(item, viewer('other'))).toBe(false);
    expect(canSeeItem(item, viewer('staff', { isInternal: true }))).toBe(false);
    expect(canSeeItem({ ...item, isPrivate: false }, viewer('other'))).toBe(true);
  });

  it('keeps a draft with its author even for people on the list', () => {
    expect(canSeeItem({ ...item, status: 'draft' }, viewer('listed'))).toBe(false);
  });

  it('does not let a sent notice that binds the company be made private', () => {
    expect(canBePrivate({ isEvidential: true, status: 'draft' })).toBe(true);
    expect(canBePrivate({ isEvidential: true, status: 'sent' })).toBe(false);
    expect(canBePrivate({ isEvidential: false, status: 'sent' })).toBe(true);
  });
});

describe('type-specific fields', () => {
  const defs = [
    { key: 'start', label: 'Start', kind: 'date' as const, required: true, options: [] },
    { key: 'level', label: 'Level', kind: 'select' as const, required: false, options: ['A', 'B'] },
    { key: 'qty', label: 'Qty', kind: 'number' as const, required: false, options: [] },
  ];

  it('refuses duplicate keys, empty selects and too many fields', () => {
    expect(checkFieldDefs(defs)).toEqual([]);
    expect(checkFieldDefs([defs[0]!, defs[0]!]).map((p) => p.path)).toEqual(['fields/1/key']);
    expect(checkFieldDefs([{ ...defs[1]!, options: [] }]).map((p) => p.path)).toEqual([
      'fields/0/options',
    ]);
    expect(checkFieldDefs([{ ...defs[0]!, key: 'Bad key' }])).toHaveLength(1);
    expect(
      checkFieldDefs(Array.from({ length: 13 }, (_, i) => ({ ...defs[2]!, key: `k${i}` }))),
    ).toHaveLength(1);
  });

  it('merges values by kind, clears with null and flags the rest', () => {
    const ok = mergeFieldValues(defs, { qty: 2 }, { start: '2027-03-01', level: 'B', qty: null });
    expect(ok).toEqual({ values: { start: '2027-03-01', level: 'B' }, problems: [] });
    const bad = mergeFieldValues(defs, {}, { start: '2027-02-30', level: 'C', qty: '5', nope: 1 });
    expect(bad.problems.map((p) => p.path)).toEqual([
      'fields/start',
      'fields/level',
      'fields/qty',
      'fields/nope',
    ]);
  });

  it('lists required fields with no value', () => {
    expect(missingRequiredFields(defs, {}).map((p) => p.path)).toEqual(['fields/start']);
    expect(missingRequiredFields(defs, { start: '2027-03-01' })).toEqual([]);
  });
});

describe('change history', () => {
  it('records short values, and only the name of a long text that changed', () => {
    const long = 'x'.repeat(300);
    expect(
      diffItem(
        { subject: 'a', body: long, dueDate: null, fileIds: [] },
        { subject: 'b', body: `${long}y`, dueDate: '2027-01-01', fileIds: ['f'] },
        ['subject', 'body', 'dueDate', 'fileIds'],
      ),
    ).toEqual([
      { field: 'subject', from: 'a', to: 'b' },
      { field: 'body' },
      { field: 'dueDate', from: null, to: '2027-01-01' },
      { field: 'fileIds', from: '0 items', to: '1 item' },
    ]);
    expect(diffItem({ a: 1 }, { a: 1 }, ['a'])).toEqual([]);
  });

  it('names type-specific changes fields.<key>', () => {
    expect(diffFieldValues({ a: 'x', b: 1 }, { a: 'y', b: 1, c: true })).toEqual([
      { field: 'fields.a', from: 'x', to: 'y' },
      { field: 'fields.c', from: null, to: true },
    ]);
  });
});
