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
  ChangeOrderMove,
  ChangeOrderRow,
  CommitmentActivityService,
  PaymentRow,
} from '../application/commitment-activity';
import { fromCents, isMoney } from '../domain/money';

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
const signed = (value: string, path: string) => {
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(value))
    throw new AppError('validation_failed', 'Invalid amount', [
      { path, message: 'Invalid amount' },
    ]);
  return value;
};

const toChangeOrderDto = (c: ChangeOrderRow) => ({
  id: encodeId('commitmentChangeOrder', c.id),
  number: c.number,
  title: c.title,
  budgetLineId: encodeId('budgetLine', c.budgetLineId),
  amount: c.amount,
  status: c.status,
  submittedAt: c.submittedAt?.toISOString() ?? null,
  decidedAt: c.decidedAt?.toISOString() ?? null,
  decisionNote: c.decisionNote,
});
const toPaymentDto = (p: PaymentRow) => ({
  id: encodeId('commitmentPayment', p.id),
  number: p.number,
  amount: p.amount,
  paidOn: p.paidOn,
  reference: p.reference,
  status: p.status,
  voidReason: p.voidReason,
});
const fig = (f: { count: number; cents: number }) => ({
  count: f.count,
  amount: fromCents(f.cents),
});

export function commitmentActivityRoutes(database: Database, activity: CommitmentActivityService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  type P = { projectId: string; commitmentId: string };
  const ids = (p: P) => [project(p), ref('commitment', p.commitmentId, 'commitmentId')] as const;
  const moveCo = async (
    input: { tenant: TenantContext | null; params: P & { changeOrderId: string } },
    to: ChangeOrderMove,
    note?: string,
  ) => {
    const [pid, cid] = ids(input.params);
    return {
      status: 200 as const,
      body: toChangeOrderDto(
        await tx(input, (s) =>
          activity.moveChangeOrder(
            s,
            pid,
            cid,
            ref('commitmentChangeOrder', input.params.changeOrderId, 'changeOrderId'),
            to,
            note ? { note } : {},
          ),
        ),
      ),
    };
  };

  return defineRoutes({
    getCommitmentSummary: async (input) => {
      const r = await read(input, (s) => activity.summary(s, project(input.params)));
      return {
        status: 200,
        body: {
          approvedCommitments: fig(r.approvedCommitments),
          pendingCommitments: fig(r.pendingCommitments),
          draftCommitments: fig(r.draftCommitments),
          approvedChangeOrders: fig(r.approvedChangeOrders),
          pendingChangeOrders: fig(r.pendingChangeOrders),
          draftChangeOrders: fig(r.draftChangeOrders),
          payments: fig(r.payments),
        },
      };
    },
    listCommitmentChangeOrders: async (input) => {
      const [pid, cid] = ids(input.params);
      return {
        status: 200,
        body: {
          data: (await read(input, (s) => activity.listChangeOrders(s, pid, cid))).map(
            toChangeOrderDto,
          ),
        },
      };
    },
    createCommitmentChangeOrder: async (input) => {
      const [pid, cid] = ids(input.params);
      const b = input.body;
      return {
        status: 201,
        body: toChangeOrderDto(
          await tx(input, (s) =>
            activity.createChangeOrder(s, pid, cid, {
              title: b.title,
              budgetLineId: ref('budgetLine', b.budgetLineId, 'budgetLineId'),
              amount: signed(b.amount, 'amount'),
            }),
          ),
        ),
      };
    },
    submitCommitmentChangeOrder: async (input) => moveCo(input, 'submitted'),
    approveCommitmentChangeOrder: async (input) => moveCo(input, 'approved', input.body?.note),
    rejectCommitmentChangeOrder: async (input) => moveCo(input, 'rejected', input.body?.note),
    listCommitmentPayments: async (input) => {
      const [pid, cid] = ids(input.params);
      return {
        status: 200,
        body: {
          data: (await read(input, (s) => activity.listPayments(s, pid, cid))).map(toPaymentDto),
        },
      };
    },
    recordCommitmentPayment: async (input) => {
      const [pid, cid] = ids(input.params);
      const b = input.body;
      if (!isMoney(b.amount))
        throw new AppError('validation_failed', 'Invalid amount', [
          { path: 'amount', message: 'Invalid amount' },
        ]);
      return {
        status: 201,
        body: toPaymentDto(
          await tx(input, (s) =>
            activity.recordPayment(s, pid, cid, {
              amount: b.amount,
              paidOn: b.paidOn,
              ...(b.reference ? { reference: b.reference } : {}),
            }),
          ),
        ),
      };
    },
    voidCommitmentPayment: async (input) => {
      const [pid, cid] = ids(input.params);
      return {
        status: 200,
        body: toPaymentDto(
          await tx(input, (s) =>
            activity.voidPayment(
              s,
              pid,
              cid,
              ref('commitmentPayment', input.params.paymentId, 'paymentId'),
              input.body.note,
            ),
          ),
        ),
      };
    },
  });
}
