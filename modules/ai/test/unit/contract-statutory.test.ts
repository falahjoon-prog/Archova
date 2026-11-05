import { describe, expect, it } from 'vitest';
import {
  applicableRules,
  reviewStatutory,
  type LegalRule,
} from '../../src/domain/contract-statutory';

const PAGES = [
  { page: 1, text: '9.1 Payment is due only when the principal has paid the contractor.' },
  { page: 2, text: '30.4 Notices are taken to be received on the next business day.' },
];
const rule = (over: Partial<LegalRule> = {}): LegalRule => ({
  ruleKey: 'pay_when_paid',
  version: 1,
  state: 'NSW',
  contractTypes: ['subcontract'],
  topic: 'Pay when paid',
  detect: 'A clause making payment depend on the principal paying.',
  wording: 'May be void under the Act. Get advice.',
  provision: 'Security of Payment Act s12',
  status: 'signed',
  signedBy: 'Lawyer A',
  signedOn: '2026-10-20',
  ...over,
});
const found = (over = {}) => ({
  ruleKey: 'pay_when_paid',
  page: 1,
  clause: '9.1',
  quote: 'Payment is due only when the principal has paid',
  ...over,
});

describe('applicableRules', () => {
  it('uses only signed rules for the state and contract type, latest version', () => {
    const rules = [
      rule(),
      rule({ version: 2, wording: 'v2' }),
      rule({ ruleKey: 'draft_one', status: 'draft', signedBy: null, signedOn: null }),
      rule({ ruleKey: 'vic_only', state: 'VIC' }),
      rule({ ruleKey: 'all_states', state: 'ALL' }),
      rule({ ruleKey: 'head_only', contractTypes: ['head_contract'] }),
      rule({ ruleKey: 'old', status: 'retired' }),
    ];
    const got = applicableRules(rules, 'NSW', 'subcontract');
    expect(got.map((r) => `${r.ruleKey}@${r.version}`)).toEqual([
      'all_states@1',
      'pay_when_paid@2',
    ]);
  });
  it('returns nothing when no rules are loaded', () => {
    expect(applicableRules([], 'NSW', 'subcontract')).toEqual([]);
  });
});

describe('reviewStatutory', () => {
  it('takes the wording and signature from the rule, not the model', () => {
    const { flags, dropped } = reviewStatutory([found()], PAGES, [rule()]);
    expect(dropped).toBe(0);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      wording: 'May be void under the Act. Get advice.',
      provision: 'Security of Payment Act s12',
      signedBy: 'Lawyer A',
      source: { page: 1, clause: '9.1' },
    });
  });
  it('drops a quote that is not on any page', () => {
    const r = reviewStatutory([found({ quote: 'This sentence is not in the contract' })], PAGES, [
      rule(),
    ]);
    expect(r).toEqual({ flags: [], dropped: 1 });
  });
  it('drops a rule key that was not sent or is unsigned', () => {
    expect(reviewStatutory([found({ ruleKey: 'invented' })], PAGES, [rule()]).dropped).toBe(1);
    expect(
      reviewStatutory([found()], PAGES, [rule({ signedBy: null, status: 'draft' })]).dropped,
    ).toBe(1);
  });
  it('drops a too-short quote and a banned word in the clause number', () => {
    expect(reviewStatutory([found({ quote: 'Payment due' })], PAGES, [rule()]).dropped).toBe(1);
    expect(reviewStatutory([found({ clause: 'void clause' })], PAGES, [rule()]).dropped).toBe(1);
  });
  it('finds the page when the model names the wrong one and flags a repeat once', () => {
    const { flags } = reviewStatutory([found({ page: 2 }), found()], PAGES, [rule()]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.source.page).toBe(1);
  });
});
