import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { FinancialsService } from '../application/financials';
import { isMoney } from '../domain/money';
import { toClaimDto, toContractDto, toLineDto, toScheduleDto, toSovDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const money = (value: string, path: string) => {
  if (!isMoney(value))
    throw new AppError('validation_failed', 'Invalid amount', [
      { path, message: 'Invalid amount' },
    ]);
  return value;
};

export function financialsRoutes(database: Database, financials: FinancialsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const claimBody = (d: Awaited<ReturnType<FinancialsService['claimDetail']>>) => ({
    claim: toClaimDto(d.claim, d.today, d.schedule !== null),
    lines: d.lines.map(toLineDto),
    schedule: d.schedule ? toScheduleDto(d.schedule) : null,
  });
  const contractBody = (d: {
    contract: Parameters<typeof toContractDto>[0];
    sov: Parameters<typeof toSovDto>[0][];
  }) => ({
    contract: toContractDto(d.contract),
    sov: d.sov.map(toSovDto),
  });

  return defineRoutes({
    listContracts: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => financials.listContracts(s, project(input.params)))).map(
          toContractDto,
        ),
      },
    }),
    createContract: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: contractBody(
          await tx(input, (s) =>
            financials.createContract(s, project(input.params), {
              kind: b.kind,
              title: b.title,
              ...(b.payerCompanyId !== undefined
                ? {
                    payerCompanyId: b.payerCompanyId
                      ? ref('company', b.payerCompanyId, 'payerCompanyId')
                      : null,
                  }
                : {}),
              ...(b.payeeCompanyId !== undefined
                ? {
                    payeeCompanyId: b.payeeCompanyId
                      ? ref('company', b.payeeCompanyId, 'payeeCompanyId')
                      : null,
                  }
                : {}),
              originalValue: money(b.originalValue, 'originalValue'),
              ...(b.retentionPct !== undefined ? { retentionPct: b.retentionPct } : {}),
              ...(b.retentionCapPct !== undefined ? { retentionCapPct: b.retentionCapPct } : {}),
              ...(b.sopaState ? { sopaState: b.sopaState } : {}),
              ...(b.scheduleDays !== undefined ? { scheduleDays: b.scheduleDays } : {}),
              ...(b.paymentDays !== undefined ? { paymentDays: b.paymentDays } : {}),
              sov: b.sov.map((i, n) => ({ ...i, value: money(i.value, `sov/${n}/value`) })),
            }),
          ),
        ),
      };
    },
    getContract: async (input) => ({
      status: 200,
      body: contractBody(
        await read(input, (s) =>
          financials.getContract(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
          ),
        ),
      ),
    }),
    submitPaymentClaim: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: claimBody(
          await tx(input, (s) =>
            financials.submitClaim(
              s,
              project(input.params),
              ref('contract', input.params.contractId, 'contractId'),
              {
                periodEnd: b.periodEnd,
                receivedAt: new Date(b.receivedAt),
                statesAct: b.statesAct,
                lines: b.lines.map((l, n) => ({
                  sovItemId: ref('sovItem', l.sovItemId, `lines/${n}/sovItemId`),
                  thisClaim: money(l.thisClaim, `lines/${n}/thisClaim`),
                })),
              },
            ),
          ),
        ),
      };
    },
    listPaymentClaims: async (input) => {
      const r = await read(input, (s) =>
        financials.listClaims(
          s,
          project(input.params),
          input.query.status ? { status: input.query.status } : {},
        ),
      );
      return {
        status: 200,
        body: { data: r.rows.map((c) => toClaimDto(c, r.today, c.status !== 'submitted')) },
      };
    },
    getPaymentClaim: async (input) => ({
      status: 200,
      body: claimBody(
        await read(input, (s) =>
          financials.claimDetail(
            s,
            project(input.params),
            ref('paymentClaim', input.params.claimId, 'claimId'),
          ),
        ),
      ),
    }),
    issuePaymentSchedule: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: claimBody(
          await tx(input, (s) =>
            financials.issueSchedule(
              s,
              project(input.params),
              ref('paymentClaim', input.params.claimId, 'claimId'),
              {
                scheduledAmount: money(b.scheduledAmount, 'scheduledAmount'),
                ...(b.overallReason ? { overallReason: b.overallReason } : {}),
                ...(b.lineReasons
                  ? {
                      lineReasons: b.lineReasons.map((r, n) => ({
                        sovItemId: ref('sovItem', r.sovItemId, `lineReasons/${n}/sovItemId`),
                        reason: r.reason,
                      })),
                    }
                  : {}),
              },
            ),
          ),
        ),
      };
    },
  });
}
