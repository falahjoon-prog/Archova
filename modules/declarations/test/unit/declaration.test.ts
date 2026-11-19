import { describe, expect, it } from 'vitest';
import {
  claimIssues,
  declarationFlags,
  declarationStatus,
  declarationTransition,
  draftChase,
  gateState,
  standingIssues,
  type Requirement,
  type RuleDeclaration,
} from '../../src/domain/declaration';
import { planDeclarationNotices, reminderStep } from '../../src/application/notices';

const REQ_ALL: Requirement[] = [
  { kind: 'workers_comp', leadDays: 30 },
  { kind: 'payroll_tax', leadDays: 14 },
  { kind: 'wages', leadDays: 7 },
];

let n = 0;
const dec = (o: Partial<RuleDeclaration> = {}): RuleDeclaration => ({
  id: `d${++n}`,
  number: n,
  companyId: 'c1',
  kind: 'workers_comp',
  lifecycle: 'accepted',
  validFrom: '2026-07-01',
  validTo: '2027-06-30',
  claimId: null,
  ...o,
});

const CLAIM = { id: 'claim-1', periodEnd: '2026-11-15' };

describe('declarationStatus', () => {
  const d = { lifecycle: 'accepted' as const, validFrom: '2026-07-01', validTo: '2026-11-30' };
  it('is current well before the end date', () => {
    expect(declarationStatus(d, '2026-09-01', 30)).toBe('current');
  });
  it('is expiring_soon inside the lead days, including the last day', () => {
    expect(declarationStatus(d, '2026-11-01', 30)).toBe('expiring_soon');
    expect(declarationStatus(d, '2026-11-30', 30)).toBe('expiring_soon');
  });
  it('is expired from the day after the end date', () => {
    expect(declarationStatus(d, '2026-12-01', 30)).toBe('expired');
  });
  it('is not_yet_valid before it starts, and rejected beats the dates', () => {
    expect(declarationStatus(d, '2026-06-30', 30)).toBe('not_yet_valid');
    expect(declarationStatus({ ...d, lifecycle: 'rejected' }, '2026-09-01', 30)).toBe('rejected');
  });
});

describe('declarationTransition', () => {
  it('rejects an accepted one and accepts a rejected one only', () => {
    expect(declarationTransition('accepted', 'reject')).toEqual({ ok: true, to: 'rejected' });
    expect(declarationTransition('rejected', 'accept')).toEqual({ ok: true, to: 'accepted' });
    expect(declarationTransition('accepted', 'accept').ok).toBe(false);
    expect(declarationTransition('rejected', 'reject').ok).toBe(false);
  });
});

describe('claimIssues', () => {
  it('has nothing to say when every required kind covers the claim period', () => {
    const declarations = REQ_ALL.map((r) => dec({ kind: r.kind }));
    expect(claimIssues({ declarations, requirements: REQ_ALL, claim: CLAIM })).toEqual([]);
  });

  it('blocks on each missing kind and names it', () => {
    const issues = claimIssues({
      declarations: [dec({ kind: 'workers_comp' })],
      requirements: REQ_ALL,
      claim: CLAIM,
    });
    expect(issues.map((i) => [i.declarationKind, i.kind, i.level])).toEqual([
      ['payroll_tax', 'missing', 'blocking'],
      ['wages', 'missing', 'blocking'],
    ]);
    expect(gateState(issues)).toBe('blocked');
  });

  it('never blocks when the project has set no requirements', () => {
    expect(claimIssues({ declarations: [], requirements: [], claim: CLAIM })).toEqual([]);
  });

  it('treats a declaration that ended before the claim period as not covering it', () => {
    const issues = claimIssues({
      declarations: [dec({ kind: 'wages', validFrom: '2026-07-01', validTo: '2026-10-31' })],
      requirements: [{ kind: 'wages', leadDays: 7 }],
      claim: CLAIM,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'expired', level: 'blocking', validTo: '2026-10-31' });
    expect(issues[0]!.message).toContain('15 Nov 2026');
  });

  it('treats a declaration that starts after the claim period as not covering it', () => {
    const issues = claimIssues({
      declarations: [dec({ kind: 'wages', validFrom: '2026-12-01', validTo: '2027-01-31' })],
      requirements: [{ kind: 'wages', leadDays: 7 }],
      claim: CLAIM,
    });
    expect(issues[0]!.kind).toBe('does_not_cover');
  });

  it('counts the end date and start date as covered', () => {
    const edges = [
      dec({ kind: 'wages', validFrom: '2026-11-15', validTo: '2026-12-15' }),
      dec({ kind: 'payroll_tax', validFrom: '2026-10-15', validTo: '2026-11-15' }),
    ];
    expect(
      claimIssues({
        declarations: edges,
        requirements: [
          { kind: 'wages', leadDays: 7 },
          { kind: 'payroll_tax', leadDays: 14 },
        ],
        claim: CLAIM,
      }),
    ).toEqual([]);
  });

  it('ignores a rejected declaration and says so when it was the only one', () => {
    const issues = claimIssues({
      declarations: [dec({ kind: 'payroll_tax', lifecycle: 'rejected' })],
      requirements: [{ kind: 'payroll_tax', leadDays: 14 }],
      claim: CLAIM,
    });
    expect(issues[0]).toMatchObject({ kind: 'rejected', level: 'blocking' });
  });

  it('a declaration given for another claim does not count by its dates', () => {
    const issues = claimIssues({
      declarations: [dec({ kind: 'wages', claimId: 'claim-other' })],
      requirements: [{ kind: 'wages', leadDays: 7 }],
      claim: CLAIM,
    });
    expect(issues[0]!.kind).toBe('missing');
  });

  it('a declaration given for this claim counts whatever its dates', () => {
    const issues = claimIssues({
      declarations: [
        dec({ kind: 'wages', claimId: 'claim-1', validFrom: '2026-01-01', validTo: '2026-01-31' }),
      ],
      requirements: [{ kind: 'wages', leadDays: 7 }],
      claim: CLAIM,
    });
    expect(issues).toEqual([]);
  });

  it('a later covering declaration makes an older lapsed one history', () => {
    const issues = claimIssues({
      declarations: [
        dec({ kind: 'workers_comp', validFrom: '2025-07-01', validTo: '2026-06-30' }),
        dec({ kind: 'workers_comp' }),
      ],
      requirements: [{ kind: 'workers_comp', leadDays: 30 }],
      claim: CLAIM,
    });
    expect(issues).toEqual([]);
  });
});

describe('standingIssues and flags', () => {
  const today = '2026-11-18';
  it('warns when a current declaration is about to run out, never blocks', () => {
    const issues = standingIssues({
      declarations: [dec({ validTo: '2026-12-10' })],
      requirements: [{ kind: 'workers_comp', leadDays: 30 }],
      today,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'expiring', level: 'warning', daysLeft: 22 });
    expect(gateState(issues)).toBe('warning');
  });

  it('blocks on a required kind with nothing current', () => {
    const issues = standingIssues({
      declarations: [dec({ kind: 'wages', validTo: '2026-10-31' })],
      requirements: REQ_ALL,
      today,
    });
    expect(issues.map((i) => [i.declarationKind, i.kind])).toEqual([
      ['workers_comp', 'missing'],
      ['payroll_tax', 'missing'],
      ['wages', 'expired'],
    ]);
  });

  it('does not report kinds that are neither required nor expiring', () => {
    expect(
      standingIssues({
        declarations: [dec({ kind: 'wages', validTo: '2026-10-31' })],
        requirements: [],
        today,
      }),
    ).toEqual([]);
  });

  it('flags the most urgent first and names the company', () => {
    const flags = declarationFlags({
      declarations: [
        { ...dec({ companyId: 'c1', validTo: '2026-11-22' }), companyName: 'Acme Electrical' },
        {
          ...dec({ companyId: 'c2', kind: 'wages', validTo: '2026-10-31' }),
          companyName: 'Bolt Plumbing',
        },
      ],
      requirements: [
        { kind: 'workers_comp', leadDays: 30 },
        { kind: 'wages', leadDays: 7 },
      ],
      today,
    });
    expect(flags[0]).toMatchObject({ severity: 'high', companyId: 'c2' });
    expect(
      flags.some((f) => f.companyId === 'c1' && f.kind === 'expiring' && f.severity === 'high'),
    ).toBe(true);
    expect(flags[0]!.title.startsWith('Bolt Plumbing:')).toBe(true);
  });
});

describe('draftChase', () => {
  const issues = claimIssues({
    declarations: [dec({ kind: 'workers_comp' })],
    requirements: REQ_ALL,
    claim: CLAIM,
  });
  const draft = draftChase({
    companyName: 'Acme Electrical',
    projectName: 'Harbour Street',
    senderName: 'Jo Builder',
    claim: { number: 4, periodEnd: '2026-11-15' },
    issues,
  })!;

  it('lists only what is missing and asks for it', () => {
    expect(draft.kinds).toEqual(['payroll_tax', 'wages']);
    expect(draft.body).toContain('Payroll tax declaration: not yet received');
    expect(draft.body).toContain('Wages and superannuation declaration: not yet received');
    expect(draft.body).not.toContain('Workers');
    expect(draft.subject).toContain('payment claim 4');
  });

  it('never threatens to hold, reduce or withhold payment', () => {
    expect(draft.body.toLowerCase()).not.toMatch(
      /withhold|hold(ing)? (up|your)|will not be paid|reduce/,
    );
  });

  it('returns nothing when nothing is missing', () => {
    expect(
      draftChase({ companyName: 'A', projectName: 'P', senderName: 'S', claim: null, issues: [] }),
    ).toBeNull();
  });
});

describe('reminders', () => {
  it('picks the most urgent step reached', () => {
    expect(reminderStep(40, null)).toBeNull();
    expect(reminderStep(30, null)).toBe(30);
    expect(reminderStep(10, null)).toBe(14);
    expect(reminderStep(0, null)).toBe(0);
  });

  const cand = {
    declarationId: 'x',
    projectId: 'p',
    number: 3,
    companyName: 'Acme',
    validTo: '2026-12-01',
    daysLeft: 13,
    leadDays: null,
    replaced: false,
    recipients: ['u1'],
  };
  it('keys the notice to the end date so a renewal re-arms it', () => {
    const [a] = planDeclarationNotices([cand]);
    const [b] = planDeclarationNotices([{ ...cand, validTo: '2027-12-01' }]);
    expect(a!.kind).toBe('declarations.workers_comp_expiring');
    expect(a!.dedupeKey).not.toBe(b!.dedupeKey);
  });
  it('says nothing about one already replaced, and raises an expired notice after the end', () => {
    expect(planDeclarationNotices([{ ...cand, replaced: true }])).toEqual([]);
    expect(planDeclarationNotices([{ ...cand, daysLeft: -2 }])[0]!.kind).toBe(
      'declarations.workers_comp_expired',
    );
  });
});
