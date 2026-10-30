import { describe, expect, it } from 'vitest';
import {
  auDate,
  canClose,
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
