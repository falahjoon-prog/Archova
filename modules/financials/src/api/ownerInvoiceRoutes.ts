import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type {
  OwnerInvoiceRow,
  OwnerInvoicesService,
  SubClaimCandidate,
} from '../application/ownerInvoices';
import { fromCents } from '../domain/money';

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

const toInvoiceDto = (r: OwnerInvoiceRow) => ({
  id: encodeId('ownerInvoice', r.id),
  contractId: encodeId('contract', r.contractId),
  number: r.number,
  periodEnd: r.periodEnd,
  markupPct: r.markupPct,
  subTotal: r.subTotal,
  markupAmount: r.markupAmount,
  total: r.total,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

const toCandidateDto = (c: SubClaimCandidate) => ({
  claimId: encodeId('paymentClaim', c.facts.claimId),
  contractId: encodeId('contract', c.facts.contractId),
  contractTitle: c.contractTitle,
  number: c.facts.number,
  periodEnd: c.facts.periodEnd,
  status: c.status as 'scheduled',
  thisPeriod: fromCents(c.facts.thisPeriodCents),
  completedToDate: fromCents(c.facts.completedToDateCents),
  amount: c.amount,
  withheld: c.withheld,
  flags: c.flags,
  backup: c.backup,
});

export function ownerInvoiceRoutes(database: Database, owner: OwnerInvoicesService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  const detailBody = (d: Awaited<ReturnType<OwnerInvoicesService['detail']>>) => ({
    invoice: toInvoiceDto(d.invoice),
    lines: d.lines.map(({ source, claim }) => ({
      claimId: encodeId('paymentClaim', source.claimId),
      contractTitle: claim?.contractTitle ?? 'Withdrawn claim',
      number: claim?.facts.number ?? 0,
      periodEnd: claim?.facts.periodEnd ?? d.invoice.periodEnd,
      amount: source.amount,
      flags: source.flags as { code: 'duplicate'; message: string }[],
      flagsConfirmedAt: source.flagsConfirmedAt?.toISOString() ?? null,
      backup: claim?.backup ?? [],
    })),
    missingBackup: d.lines.reduce(
      (n, l) => n + (l.claim?.backup.filter((b) => b.status === 'missing').length ?? 0),
      0,
    ),
  });

  return defineRoutes({
    getOwnerInvoicePrefill: async (input) => {
      const r = await read(input, (s) =>
        owner.prefill(
          s,
          project(input.params),
          ref('contract', input.params.contractId, 'contractId'),
          input.query.periodEnd,
        ),
      );
      return {
        status: 200,
        body: { periodEnd: r.periodEnd, candidates: r.candidates.map(toCandidateDto) },
      };
    },
    listOwnerInvoices: async (input) => {
      const rows = await read(input, (s) =>
        owner.list(
          s,
          project(input.params),
          ref('contract', input.params.contractId, 'contractId'),
        ),
      );
      return { status: 200, body: { data: rows.map(toInvoiceDto) } };
    },
    createOwnerInvoice: async (input) => {
      const body = input.body;
      const d = await tx(input, (s) =>
        owner.create(
          s,
          project(input.params),
          ref('contract', input.params.contractId, 'contractId'),
          {
            periodEnd: body.periodEnd,
            markupPct: body.markupPct,
            ...(body.note ? { note: body.note } : {}),
            claimIds: body.claimIds.map((c, i) => ref('paymentClaim', c, `claimIds/${i}`)),
            confirmedClaimIds: body.confirmedClaimIds.map((c, i) =>
              ref('paymentClaim', c, `confirmedClaimIds/${i}`),
            ),
          },
        ),
      );
      return { status: 201, body: detailBody(d) };
    },
    getOwnerInvoice: async (input) => ({
      status: 200,
      body: detailBody(
        await read(input, (s) =>
          owner.detail(
            s,
            project(input.params),
            ref('ownerInvoice', input.params.ownerInvoiceId, 'ownerInvoiceId'),
          ),
        ),
      ),
    }),
    discardOwnerInvoice: async (input) => {
      await tx(input, (s) =>
        owner.discard(
          s,
          project(input.params),
          ref('ownerInvoice', input.params.ownerInvoiceId, 'ownerInvoiceId'),
        ),
      );
      return { status: 204 };
    },
  });
}
