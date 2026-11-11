import { describe, expect, it } from 'vitest';
import { createReadinessService } from '../../src/application/readiness';
import { attentionItems, packLines, type ReadinessPack } from '../../src/domain/readiness';
import type { ReportingDeps } from '../../src/application/sources';

const empty = (): ReadinessPack => ({
  generatedOn: '2026-11-05',
  timeZone: 'Australia/Sydney',
  prequal: {
    restricted: false,
    companies: 0,
    qualified: 0,
    expiring: 0,
    pending: 0,
    expired: 0,
    notQualified: 0,
    requiredForTenders: false,
  },
  credentials: { restricted: false, current: 0, expiring: 0, expired: 0, noExpiry: 0, items: [] },
  safety: {
    projectsCovered: 0,
    projectsRestricted: 0,
    incidents: { total: 0, notifiable: 0, notClosed: 0, high: 0, critical: 0 },
    swms: { accepted: 0, expired: 0, awaitingReview: 0, rejected: 0 },
  },
  trust: {
    projectsCovered: 0,
    projectsRestricted: 0,
    subcontracts: 0,
    ok: 0,
    shortfall: 0,
    notSetUp: 0,
    notRequired: 0,
    shortfallCents: 0,
  },
  truncated: false,
});

describe('attentionItems', () => {
  it('is empty when nothing stands out', () => {
    expect(attentionItems(empty())).toEqual([]);
  });

  it('lists expired documents first and uses singular and plural forms', () => {
    const p = empty();
    p.credentials.expired = 1;
    p.credentials.expiring = 2;
    p.safety.incidents.critical = 1;
    p.trust.shortfall = 2;
    const texts = attentionItems(p).map((a) => a.text);
    expect(texts[0]).toBe('1 licence or insurance past expiry.');
    expect(texts[1]).toBe('2 licences or insurances expiring within 30 days.');
    expect(texts.join(' ')).toContain('1 critical incident in the last 12 months.');
  });

  it('says nothing about a section the caller may not read', () => {
    const p = empty();
    p.credentials = { ...p.credentials, restricted: true, expired: 5 };
    expect(attentionItems(p)).toEqual([]);
  });
});

describe('packLines', () => {
  it('never claims documents are verified and shows restricted sections as not shown', () => {
    const p = empty();
    p.prequal.restricted = true;
    const text = packLines(p)
      .map((l) => l.text)
      .join('\n');
    expect(text.replace('checked against', '')).not.toMatch(/verified/i);
    expect(text).toContain('none has been checked against a licensing or insurer register');
    expect(text).toContain('Not shown: you do not have access to prequalification.');
  });
});

const day = (id: string) => ({ id, name: id, number: null, status: 'active' });

function deps(over: Partial<ReportingDeps> = {}): ReportingDeps {
  const tool = {
    portfolioCounts: async () => ({ restricted: false, open: 0, overdue: 0, dueSoon: 0 }),
    reportRows: async () => ({ rows: [], truncated: false, restricted: false }),
  };
  return {
    platform: {
      listProjects: async () => ({ data: [day('a'), day('b')], nextCursor: null }),
    } as unknown as ReportingDeps['platform'],
    environment: { portfolioSummary: async () => ({ restricted: true }) as never },
    rfis: tool,
    defects: tool,
    submittals: tool,
    claims: tool,
    variations: tool,
    incidents: {
      ...tool,
      portfolioCounts: async () => ({
        ...(await tool.portfolioCounts()),
        lastInjuryOn: null,
        lastIncidentOn: null,
        daysSinceInjury: null,
        daysSinceIncident: null,
        last12Months: 0,
      }),
    },
    observations: tool,
    inspections: tool,
    programme: {
      ...tool,
      portfolioCounts: async () => ({
        ...(await tool.portfolioCounts()),
        notStarted: 0,
        completed: 0,
        lateDays: 0,
      }),
    },
    budget: {
      portfolioSummary: async () => ({
        restricted: true,
        hasBudget: false,
        revisedCents: 0,
        forecastFinalCents: 0,
        spentCents: 0,
        varianceCents: 0,
        overBudgetCodes: 0,
        monthly: [],
      }),
    },
    time: {
      timeForReporting: async () => ({ restricted: true, truncated: false, lines: [] }),
      costCodes: async () => null,
    },
    access: { can: async () => true },
    precon: {
      readinessSummary: async () => ({
        companies: 3,
        qualified: 2,
        expiring: 0,
        pending: 0,
        expired: 1,
        not_qualified: 0,
        requiredForTenders: true,
      }),
    },
    workforce: {
      credentialSummary: async () => ({
        counts: { current: 1, expiring: 0, expired: 1, no_expiry: 0 },
        items: [
          {
            itemType: 'public_liability',
            title: 'PL policy',
            insurer: 'Acme',
            expiresOn: '2026-10-01',
            evidence: 'sighted' as const,
            state: 'expired' as const,
          },
        ],
      }),
    },
    safety: {
      readinessSummary: async (_s, id) =>
        id === 'b'
          ? {
              restricted: true,
              incidents: {
                total: 0,
                notifiable: 0,
                notClosed: 0,
                bySeverity: { high: 0, critical: 0 },
              },
              swms: { accepted: 0, expired: 0, awaitingReview: 0, rejected: 0 },
            }
          : {
              restricted: false,
              incidents: {
                total: 4,
                notifiable: 1,
                notClosed: 2,
                bySeverity: { high: 1, critical: 1 },
              },
              swms: { accepted: 3, expired: 1, awaitingReview: 0, rejected: 0 },
            },
    },
    financials: {
      trustSummary: async () => ({
        restricted: false,
        subcontracts: 2,
        shortfallCents: 5_000,
        ok: 1,
        shortfall: 1,
        not_set_up: 0,
        not_required: 0,
      }),
    },
    ...over,
  };
}

describe('readiness service', () => {
  const scope = {} as never;
  const now = () => new Date('2026-11-05T02:00:00Z');

  it('adds up what the caller can read and counts the projects left out', async () => {
    const pack = await createReadinessService({ ...deps(), now }).build(scope);
    expect(pack.generatedOn).toBe('2026-11-05');
    expect(pack.prequal).toMatchObject({ restricted: false, companies: 3, expired: 1 });
    expect(pack.credentials.items).toHaveLength(1);
    expect(pack.safety).toMatchObject({ projectsCovered: 1, projectsRestricted: 1 });
    expect(pack.safety.incidents).toMatchObject({ total: 4, high: 1, critical: 1 });
    expect(pack.trust).toMatchObject({
      projectsCovered: 2,
      subcontracts: 4,
      shortfallCents: 10_000,
    });
    expect(pack.attention.length).toBeGreaterThan(0);
  });

  it('does not call a module the caller has no permission for', async () => {
    let called = 0;
    const d = deps({
      access: {
        can: async (_s, key) => key !== 'precon.prequal.view' && key !== 'workforce.wallet.view',
      },
      precon: {
        readinessSummary: async () => {
          called += 1;
          throw new Error('should not be called');
        },
      },
    });
    const pack = await createReadinessService({ ...d, now }).build(scope);
    expect(called).toBe(0);
    expect(pack.prequal.restricted).toBe(true);
    expect(pack.credentials.restricted).toBe(true);
  });

  it('renders a PDF', async () => {
    const out = await createReadinessService({ ...deps(), now }).pdf(scope);
    expect(out.filename).toBe('tender-readiness-2026-11-05.pdf');
    expect(Buffer.from(out.dataBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});
