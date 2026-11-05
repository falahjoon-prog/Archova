import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { createRiskService } from '../../src/application/risk';

const scope = {} as TenantScope;
const P1 = '0190a000-0000-7000-8000-000000000001';
const P2 = '0190a000-0000-7000-8000-000000000002';
const P3 = '0190a000-0000-7000-8000-000000000003';
const SUB = '0190a000-0000-7000-8000-0000000000c1';
const SUB_ORG = '0190a000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-11-05T02:00:00Z'); // 13:00 in Sydney

const finClaim = (over = {}) => ({
  claimId: '0190a000-0000-7000-8000-0000000000a1',
  claimNumber: 1,
  contractId: '0190a000-0000-7000-8000-0000000000b1',
  contractNumber: 1,
  contractTitle: 'Electrical',
  payeeCompanyId: SUB,
  scheduleDueOn: '2026-11-06',
  paymentDueOn: '2026-11-20',
  claimedTotal: '1000.00',
  claimedTotalCents: 100_000,
  ...over,
});

function build(opts: { wallet?: unknown; fin?: Record<string, unknown> } = {}) {
  const insuranceSignals = vi.fn(
    async () =>
      (opts.wallet ?? {
        restricted: false,
        insurances: [
          {
            subbieOrgId: SUB_ORG,
            documentId: 'd',
            itemType: 'public_liability',
            title: 'PL',
            insurer: null,
            expiresOn: '2026-10-01',
            expiry: 'expired',
          },
        ],
        unseen: [],
      }) as never,
  );
  const sopaRiskSignals = vi.fn(
    async (_s: TenantScope, projectId: string) =>
      (opts.fin?.[projectId] ?? { restricted: false, claims: [] }) as never,
  );
  const slipSignals = vi.fn(async () => ({
    restricted: false as const,
    hasProgramme: true,
    lateCount: 3,
    worst: [
      {
        id: '0190a000-0000-7000-8000-0000000000e1',
        wbs: '1.2',
        name: 'Slab',
        finish: '2026-10-20',
        pctComplete: 40,
        daysLate: 16,
      },
    ],
  }));
  const svc = createRiskService({
    platform: {
      listProjects: async () => ({
        data: [P1, P2, P3].map((id, i) => ({
          id,
          name: `Project ${i + 1}`,
          number: null,
          status: 'active',
        })),
        nextCursor: null,
      }),
      getProject: async () => ({ timezone: 'Australia/Sydney' }),
      companyLinkedOrgs: async () => new Map([[SUB, { name: 'Sparky', linkedOrgId: SUB_ORG }]]),
    } as never,
    rfis: {} as never,
    defects: {} as never,
    submittals: {} as never,
    financials: { sopaRiskSignals } as never,
    scheduling: { slipSignals },
    workforce: { insuranceSignals } as never,
    now: () => NOW,
  } as never);
  return { svc, insuranceSignals, sopaRiskSignals, slipSignals };
}

describe('lateSopaClaims', () => {
  it('ranks a project with expired insurance and slip as high, with the facts and links', async () => {
    const { svc } = build({ fin: { [P1]: { restricted: false, claims: [finClaim()] } } });
    const out = await svc.lateSopaClaims(scope, { includeClosed: false });
    expect(out.unreadableProjects).toBe(0);
    expect(out.projects).toHaveLength(1);
    const p = out.projects[0]!;
    expect(p.projectName).toBe('Project 1');
    expect(p.level).toBe('high');
    expect(p.claims[0]).toMatchObject({ subbieName: 'Sparky', insurance: 'expired' });
    expect(p.claims[0]!.claimId).not.toBe(finClaim().claimId); // encoded for the API
    expect(p.slip).toMatchObject({ lateCount: 3 });
    expect(p.slip.worst[0]).toMatchObject({ name: 'Slab', daysLate: 16 });
  });

  it('counts projects whose claims the caller cannot read and never lists them', async () => {
    const { svc, insuranceSignals, slipSignals } = build({
      fin: { [P1]: { restricted: true, claims: [] } },
    });
    const out = await svc.lateSopaClaims(scope, { includeClosed: false });
    expect(out.projects).toEqual([]);
    expect(out.unreadableProjects).toBe(1);
    expect(insuranceSignals).not.toHaveBeenCalled();
    expect(slipSignals).not.toHaveBeenCalled();
  });

  it('reads the wallet and programme only for projects with a claim near its deadline', async () => {
    const { svc, insuranceSignals } = build({
      fin: { [P1]: { restricted: false, claims: [finClaim({ scheduleDueOn: '2026-12-31' })] } },
    });
    const out = await svc.lateSopaClaims(scope, { includeClosed: false });
    expect(out.projects).toEqual([]);
    expect(insuranceSignals).not.toHaveBeenCalled();
  });

  it('says insurance is not visible when the wallet has no grant or is restricted', async () => {
    for (const wallet of [
      { restricted: false, insurances: [], unseen: [SUB_ORG] },
      { restricted: true, insurances: [], unseen: [SUB_ORG] },
    ]) {
      const { svc } = build({
        wallet,
        fin: { [P1]: { restricted: false, claims: [finClaim()] } },
      });
      const out = await svc.lateSopaClaims(scope, { includeClosed: false });
      expect(out.projects[0]!.claims[0]!.insurance).toBe('not_visible');
      expect(out.projects[0]!.unknown).toContain('insurance');
      expect(out.projects[0]!.level).toBe('medium'); // slip only
    }
  });
});
