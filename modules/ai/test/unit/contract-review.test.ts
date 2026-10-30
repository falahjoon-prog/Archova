import { describe, expect, it } from 'vitest';
import type { ContractReviewOutput } from '@archova/ai-prompts';
import {
  APPROVED_WORDING_LABEL,
  CONTRACT_DISCLAIMER,
  hasBannedWord,
  reviewContract,
  type PlaybookTopic,
} from '../../src/domain/contract-review';

const PAGES = [
  { page: 1, text: '12.2 Liquidated damages are $2,500 a day.\n14.1 Retention of 10% is held.' },
  { page: 2, text: '20.1 Notice of delay within 5 business days.' },
];
const topic = (key: string, over: Partial<PlaybookTopic> = {}): PlaybookTopic => ({
  key,
  topic: key,
  position: 'Capped.',
  threshold: null,
  severity: 'high',
  fallback: null,
  ...over,
});
const FALLBACK = {
  title: 'LD cap',
  wording: 'LDs are capped at 10%.',
  approvedBy: 'Jo',
  approvedOn: '2026-08-01',
  reviewBy: '2027-08-01',
};
const dep = (over: Partial<ContractReviewOutput['departures'][number]> = {}) => ({
  topicKey: 'ld_cap',
  finding: 'The clause has no cap.',
  page: 1,
  clause: '12.2',
  quote: 'Liquidated damages are $2,500 a day.',
  ...over,
});
const out = (departures: ContractReviewOutput['departures']): ContractReviewOutput => ({
  summary: [],
  timeBars: [],
  departures,
});
const run = (o: ContractReviewOutput, playbook = [topic('ld_cap')], today = '2026-10-30') =>
  reviewContract(o, PAGES, playbook, today);

describe('contract review rules', () => {
  it('carries the fixed disclaimer', () => {
    expect(run(out([])).disclaimer).toBe(CONTRACT_DISCLAIMER);
    expect(CONTRACT_DISCLAIMER).toContain('This is not legal advice.');
  });

  it('shows a flag only when its quote is on a page, and fixes a wrong page number', () => {
    const r = run(out([dep({ page: 2 }), dep({ quote: 'Liquidated damages are capped.' })]));
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]!.source.page).toBe(1);
    expect(r.dropped.notOnPage).toBe(1);
  });

  it('matches quotes across spacing, case and typographic apostrophes', () => {
    const r = reviewContract(
      out([dep({ quote: 'LIQUIDATED   damages are $2,500 a\nday.' })]),
      PAGES,
      [topic('ld_cap')],
      '2026-10-30',
    );
    expect(r.flags).toHaveLength(1);
  });

  it('refuses quotes too short to show anything, and clause text that is long or uses a banned word', () => {
    for (const quote of ['12.2', 'Retention of', 'a'.repeat(401)]) {
      const r = run(out([dep({ quote })]));
      expect(r.flags, quote).toHaveLength(0);
    }
    expect(
      run(out([dep({ clause: '12.2 and this clause is fair to the builder overall' })])).flags,
    ).toHaveLength(0);
    expect(run(out([dep({ clause: 'safe 12.2' })])).dropped.bannedWords).toBe(1);
    expect(run(out([dep()])).flags[0]!.source.clause).toBe('12.2');
  });

  it('drops a flag for a topic that is not in the playbook', () => {
    const r = run(out([dep({ topicKey: 'made_up' })]));
    expect(r.flags).toHaveLength(0);
    expect(r.dropped.unknownTopic).toBe(1);
  });

  it('drops model text that uses a banned word', () => {
    for (const finding of [
      'This clause is unfair.',
      'The clause is not enforceable.',
      'It is safe to sign.',
      'This is a standard clause.',
      'You should not sign this.',
    ]) {
      const r = run(out([dep({ finding })]));
      expect(r.flags, finding).toHaveLength(0);
      expect(r.dropped.bannedWords).toBe(1);
    }
    expect(hasBannedWord('The contract says the form is a standard form AS 4000.')).toBe(false);
  });

  it('offers wording only from the playbook fallback, labelled, while it is in date', () => {
    const r = run(out([dep()]), [topic('ld_cap', { fallback: FALLBACK })]);
    expect(r.flags[0]!.wordingStatus).toBe('offered');
    expect(r.flags[0]!.approvedWording).toMatchObject({
      wording: FALLBACK.wording,
      label: APPROVED_WORDING_LABEL,
      approvalNote: expect.stringContaining('recorded by an org admin'),
      approvedBy: 'Jo',
    });
  });

  it('stops offering wording past its review date, and offers none when there is none', () => {
    const stale = run(out([dep()]), [topic('ld_cap', { fallback: FALLBACK })], '2027-09-01');
    expect(stale.flags[0]!.wordingStatus).toBe('review_due');
    expect(stale.flags[0]!.approvedWording).toBeNull();
    const none = run(out([dep()]));
    expect(none.flags[0]!.wordingStatus).toBe('none');
    expect(none.flags[0]!.approvedWording).toBeNull();
  });

  it('takes severity from the playbook, not the model, and sorts high first', () => {
    const r = run(
      out([dep({ topicKey: 'ret', quote: 'Retention of 10% is held.', clause: '14.1' }), dep()]),
      [topic('ld_cap'), topic('ret', { severity: 'low' })],
    );
    expect(r.flags.map((f) => [f.topicKey, f.severity])).toEqual([
      ['ld_cap', 'high'],
      ['ret', 'low'],
    ]);
  });

  it('lists summary terms it did not find, and keeps time bars on their page', () => {
    const r = run({
      summary: [
        {
          key: 'liquidated_damages',
          text: 'Liquidated damages are $2,500 a day.',
          page: 1,
          clause: '12.2',
          quote: 'Liquidated damages are $2,500 a day.',
        },
      ],
      timeBars: [
        {
          event: 'delay_notice',
          period: 'within 5 business days',
          days: 5,
          dayType: 'business',
          page: 2,
          clause: '20.1',
          quote: 'Notice of delay within 5 business days.',
        },
      ],
      departures: [],
    });
    expect(r.summary.map((s) => s.key)).toEqual(['liquidated_damages']);
    expect(r.summaryNotFound).toContain('contract_sum');
    expect(r.summaryNotFound).not.toContain('liquidated_damages');
    expect(r.timeBars[0]).toMatchObject({ days: 5, dayType: 'business' });
  });
});
