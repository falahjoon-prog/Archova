import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { PaymentRow, PaymentsService } from '../application/payments';

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
const claim = (p: { claimId: string }) => {
  const id = decodeId('paymentClaim', p.claimId);
  if (!id) throw new AppError('financials.claim.not_found');
  return id;
};

const toPaymentDto = (p: PaymentRow) => ({
  id: encodeId('payment', p.id),
  paidOn: p.paidOn,
  amount: p.amount,
  reference: p.reference,
  source: p.source,
  reversesPaymentId: p.reversesPaymentId ? encodeId('payment', p.reversesPaymentId) : null,
  recordedAt: p.recordedAt.toISOString(),
});

const toBody = (s: Awaited<ReturnType<PaymentsService['list']>>) => ({
  claimId: encodeId('paymentClaim', s.claimId),
  payments: s.payments.map(toPaymentDto),
  amountDue: s.amountDue,
  paid: s.paid,
  outstanding: s.outstanding,
});

export function paymentRoutes(database: Database, svc: PaymentsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  return defineRoutes({
    listClaimPayments: async (input) => ({
      status: 200,
      body: toBody(
        await read(input, (s) => svc.list(s, project(input.params), claim(input.params))),
      ),
    }),
    recordClaimPayment: async (input) => ({
      status: 201,
      body: toBody(
        await tx(input, (s) =>
          svc.record(s, project(input.params), claim(input.params), {
            paidOn: input.body.paidOn,
            amount: input.body.amount,
            reference: input.body.reference,
          }),
        ),
      ),
    }),
    reverseClaimPayment: async (input) => ({
      status: 200,
      body: toBody(
        await tx(input, (s) =>
          svc.reverse(
            s,
            project(input.params),
            claim(input.params),
            ref('payment', input.params.paymentId, 'paymentId'),
            input.body?.note,
          ),
        ),
      ),
    }),
  });
}
