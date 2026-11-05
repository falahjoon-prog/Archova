import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { RetentionService } from '../application/retention';
import { toRetentionDto } from './retention-mappers';
import type { CommitmentsService, CommitmentMove } from '../application/commitments';
import type { TrustService } from '../application/trust';
import { toPaymentSummaryDto, toTrustDto } from './trust-mappers';
import type { ForecastService } from '../application/forecast';
import { toAdjustmentDto, toForecastDto } from './forecast-mappers';
import type { FinancialsService } from '../application/financials';
import { isMoney } from '../domain/money';
import {
  toClaimDto,
  toCommitmentDto,
  toCommitmentLineDto,
  toContractDto,
  toLineDto,
  toScheduleDto,
  toStatementDto,
  toSovDto,
  toVariationDto,
} from './mappers';

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

export function financialsRoutes(
  database: Database,
  financials: FinancialsService,
  forecast: ForecastService,
  commitments: CommitmentsService,
  trust: TrustService,
  retention: RetentionService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const claimBody = (d: Awaited<ReturnType<FinancialsService['claimDetail']>>) => ({
    claim: toClaimDto(d.claim, d.today, d.schedule !== null),
    lines: d.lines.map(toLineDto),
    schedule: d.schedule ? toScheduleDto(d.schedule) : null,
    statement: d.statement ? toStatementDto(d.statement) : null,
    warnings: d.warnings,
  });
  const contractBody = (d: {
    contract: Parameters<typeof toContractDto>[0];
    sov: Parameters<typeof toSovDto>[0][];
  }) => ({
    contract: toContractDto(d.contract),
    sov: d.sov.map(toSovDto),
  });

  const move = async (
    input: { tenant: TenantContext | null; params: { projectId: string; variationId: string } },
    to: 'submitted' | 'approved' | 'rejected' | 'withdrawn',
    note?: string,
  ) => ({
    status: 200 as const,
    body: toVariationDto(
      await tx(input, (s) =>
        financials.moveVariation(
          s,
          project(input.params),
          ref('variation', input.params.variationId, 'variationId'),
          to,
          note,
        ),
      ),
    ),
  });

  const commitmentBody = (d: Awaited<ReturnType<CommitmentsService['getCommitment']>>) => ({
    commitment: toCommitmentDto(d.commitment),
    lines: d.lines.map(toCommitmentLineDto),
  });
  const moveCommitment = async (
    input: { tenant: TenantContext | null; params: { projectId: string; commitmentId: string } },
    to: CommitmentMove,
    opts: { note?: string; allowOverBudget?: boolean } = {},
  ) => ({
    status: 200 as const,
    body: commitmentBody(
      await tx(input, (s) =>
        commitments.moveCommitment(
          s,
          project(input.params),
          ref('commitment', input.params.commitmentId, 'commitmentId'),
          to,
          opts,
        ),
      ),
    ),
  });

  return defineRoutes({
    listCommitments: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => commitments.listCommitments(s, project(input.params)))).map(
          toCommitmentDto,
        ),
      },
    }),
    createCommitment: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: commitmentBody(
          await tx(input, (s) =>
            commitments.createCommitment(s, project(input.params), {
              kind: b.kind,
              title: b.title,
              ...(b.vendorCompanyId !== undefined
                ? {
                    vendorCompanyId: b.vendorCompanyId
                      ? ref('company', b.vendorCompanyId, 'vendorCompanyId')
                      : null,
                  }
                : {}),
              lines: b.lines.map((l, n) => ({
                budgetLineId: ref('budgetLine', l.budgetLineId, `lines/${n}/budgetLineId`),
                description: l.description,
                amount: money(l.amount, `lines/${n}/amount`),
              })),
            }),
          ),
        ),
      };
    },
    getCommitment: async (input) => ({
      status: 200,
      body: commitmentBody(
        await read(input, (s) =>
          commitments.getCommitment(
            s,
            project(input.params),
            ref('commitment', input.params.commitmentId, 'commitmentId'),
          ),
        ),
      ),
    }),
    submitCommitment: async (input) => moveCommitment(input, 'submitted'),
    approveCommitment: async (input) =>
      moveCommitment(input, 'approved', {
        ...(input.body?.note ? { note: input.body.note } : {}),
        allowOverBudget: input.body?.allowOverBudget === true,
      }),
    rejectCommitment: async (input) =>
      moveCommitment(input, 'rejected', input.body?.note ? { note: input.body.note } : {}),
    voidCommitment: async (input) =>
      moveCommitment(input, 'void', input.body?.note ? { note: input.body.note } : {}),

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
              sov: b.sov.map((i, n) => ({
                code: i.code,
                description: i.description,
                value: money(i.value, `sov/${n}/value`),
                ...(i.costCodeId
                  ? { costCodeId: ref('costCode', i.costCodeId, `sov/${n}/costCodeId`) }
                  : {}),
              })),
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
    listVariations: async (input) => {
      const r = await read(input, (s) =>
        financials.listVariations(
          s,
          project(input.params),
          ref('contract', input.params.contractId, 'contractId'),
        ),
      );
      return {
        status: 200,
        body: { data: r.rows.map(toVariationDto), approvedTotal: r.approvedTotal },
      };
    },
    createVariation: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toVariationDto(
          await tx(input, (s) =>
            financials.createVariation(
              s,
              project(input.params),
              ref('contract', input.params.contractId, 'contractId'),
              {
                title: b.title,
                ...(b.description ? { description: b.description } : {}),
                amount: money(b.amount, 'amount'),
                ...(b.timeImpactDays !== undefined ? { timeImpactDays: b.timeImpactDays } : {}),
                ...(b.costCodeId
                  ? { costCodeId: ref('costCode', b.costCodeId, 'costCodeId') }
                  : {}),
              },
            ),
          ),
        ),
      };
    },
    getVariation: async (input) => ({
      status: 200,
      body: toVariationDto(
        await read(input, (s) =>
          financials.getVariation(
            s,
            project(input.params),
            ref('variation', input.params.variationId, 'variationId'),
          ),
        ),
      ),
    }),
    getCostForecast: async (input) => ({
      status: 200,
      body: toForecastDto(
        await read(input, (s) => forecast.costForecast(s, project(input.params))),
      ),
    }),
    createForecastAdjustment: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toAdjustmentDto(
          await tx(input, (s) =>
            forecast.createAdjustment(s, project(input.params), {
              ...(b.contractId ? { contractId: ref('contract', b.contractId, 'contractId') } : {}),
              category: b.category,
              label: b.label,
              ...(b.costCodeId ? { costCodeId: ref('costCode', b.costCodeId, 'costCodeId') } : {}),
              ...(b.note ? { note: b.note } : {}),
              amount: b.amount,
            }),
          ),
        ),
      };
    },
    deleteForecastAdjustment: async (input) => {
      await tx(input, (s) =>
        forecast.deleteAdjustment(
          s,
          project(input.params),
          ref('forecastAdjustment', input.params.adjustmentId, 'adjustmentId'),
        ),
      );
      return { status: 204 };
    },
    getContractPaymentSummary: async (input) => ({
      status: 200,
      body: toPaymentSummaryDto(
        await read(input, (s) =>
          trust.paymentSummary(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
          ),
        ),
      ),
    }),
    getContractTrust: async (input) => ({
      status: 200,
      body: toTrustDto(
        await read(input, (s) =>
          trust.getTrust(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
          ),
        ),
      ),
    }),
    saveContractTrust: async (input) => ({
      status: 200,
      body: toTrustDto(
        await tx(input, (s) =>
          trust.saveProfile(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
            input.body,
          ),
        ),
      ),
    }),
    recordTrustMovement: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toTrustDto(
          await tx(input, (s) =>
            trust.recordMovement(
              s,
              project(input.params),
              ref('contract', input.params.contractId, 'contractId'),
              {
                kind: b.kind,
                amount: money(b.amount, 'amount'),
                movedOn: b.movedOn,
                reference: b.reference,
                ...(b.note ? { note: b.note } : {}),
                ...(b.reversesMovementId
                  ? {
                      reversesMovementId: ref(
                        'trustMovement',
                        b.reversesMovementId,
                        'reversesMovementId',
                      ),
                    }
                  : {}),
              },
            ),
          ),
        ),
      };
    },
    getContractRetentionRelease: async (input) => ({
      status: 200,
      body: toRetentionDto(
        await read(input, (s) =>
          retention.get(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
          ),
        ),
      ),
    }),
    saveContractRetentionTerms: async (input) => ({
      status: 200,
      body: toRetentionDto(
        await tx(input, (s) =>
          retention.saveTerms(
            s,
            project(input.params),
            ref('contract', input.params.contractId, 'contractId'),
            input.body,
          ),
        ),
      ),
    }),
    recordRetentionRelease: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toRetentionDto(
          await tx(input, (s) =>
            retention.recordRelease(
              s,
              project(input.params),
              ref('contract', input.params.contractId, 'contractId'),
              {
                stage: b.stage,
                amount: money(b.amount, 'amount'),
                releasedOn: b.releasedOn,
                reference: b.reference,
                ...(b.note ? { note: b.note } : {}),
                ...(b.fromTrust !== undefined ? { fromTrust: b.fromTrust } : {}),
              },
            ),
          ),
        ),
      };
    },
    submitVariation: async (input) => move(input, 'submitted'),
    approveVariation: async (input) => move(input, 'approved', input.body?.note),
    rejectVariation: async (input) => move(input, 'rejected', input.body?.note),
    withdrawVariation: async (input) => move(input, 'withdrawn'),
    setVariationCostCode: async (input) => ({
      status: 200,
      body: toVariationDto(
        await tx(input, (s) =>
          financials.setVariationCostCode(
            s,
            project(input.params),
            ref('variation', input.params.variationId, 'variationId'),
            input.body.costCodeId ? ref('costCode', input.body.costCodeId, 'costCodeId') : null,
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
                  ...(l.sovItemId
                    ? { sovItemId: ref('sovItem', l.sovItemId, `lines/${n}/sovItemId`) }
                    : {}),
                  ...(l.variationId
                    ? { variationId: ref('variation', l.variationId, `lines/${n}/variationId`) }
                    : {}),
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
    listClaimEvidence: async (input) => ({
      status: 200,
      body: {
        records: (
          await read(input, (s) =>
            financials.listEvidence(
              s,
              project(input.params),
              ref('paymentClaim', input.params.claimId, 'claimId'),
            ),
          )
        ).map((r) => ({ ...r, sealedAt: r.sealedAt.toISOString() })),
      },
    }),
    getClaimEvidencePdf: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        financials.evidencePdf(
          s,
          project(input.params),
          ref('paymentClaim', input.params.claimId, 'claimId'),
          input.params.kind,
        ),
      ),
    }),
    getClaimEvidenceJson: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        financials.evidenceJson(
          s,
          project(input.params),
          ref('paymentClaim', input.params.claimId, 'claimId'),
          input.params.kind,
        ),
      ),
    }),
    recordClaimStatement: async (input) => {
      const b = input.body;
      return {
        status: 200,
        body: claimBody(
          await tx(input, (s) =>
            financials.recordStatement(
              s,
              project(input.params),
              ref('paymentClaim', input.params.claimId, 'claimId'),
              {
                periodEnd: b.periodEnd,
                receivedOn: b.receivedOn,
                ...(b.signedOn ? { signedOn: b.signedOn } : {}),
                ...(b.note ? { note: b.note } : {}),
              },
            ),
          ),
        ),
      };
    },
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
