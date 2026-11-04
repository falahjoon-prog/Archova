import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AdjustmentService, CatalogueService } from '@archova/mod-billing';
import type { RequestDto, RequestKind, RequestStatus } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import { orgActions, requests, staffUsers } from '../infra/tables';
import type { StaffContext, StaffService } from './staff';

export interface RequestDeps extends Pick<KernelServices, 'database'> {
  catalogue: CatalogueService;
  adjustments: AdjustmentService;
  staff: StaffService;
  /** Solo-owner mode delay for a pricing publish (Sam 12 §4: 24 hours). */
  soloCoolingOffHours: number;
  now?: () => Date;
}

/** What approving each kind of request does, and who may approve it. */
const KINDS: Record<
  RequestKind,
  {
    permission: string;
    execute(
      deps: RequestDeps,
      ref: string,
      by: string,
      now: Date,
      tx: Tx,
    ): Promise<Record<string, unknown>>;
    /** Puts the draft back to editable when the request is rejected, cancelled or fails. */
    release(deps: RequestDeps, ref: string, tx?: Tx): Promise<void>;
  }
> = {
  'pricebook.publish': {
    permission: 'backoffice.pricing.approve',
    execute: async (d, ref, by, now, tx) => ({
      ...(await d.catalogue.publishPriceBook(ref, by, now, tx)),
    }),
    release: (d, ref, tx) => d.catalogue.returnPriceBook(ref, tx),
  },
  'plan.publish': {
    permission: 'backoffice.pricing.approve',
    execute: async (d, ref, by, now, tx) => ({
      ...(await d.catalogue.publishPlanDraft(ref, by, now, tx)),
    }),
    release: (d, ref, tx) => d.catalogue.returnPlanDraft(ref, tx),
  },
  // The subject is the pending refund's id. Approving it settles the record and logs the customer-visible action;
  // a rejected, cancelled or failed request cancels the record so the invoice's balance is free again.
  refund: {
    permission: 'backoffice.accounts.refund_approve',
    execute: async (d, ref, by, now, tx) => {
      const refund = await d.adjustments.settleRefund(tx, ref, 'approved', by, now);
      const [approver] = await tx
        .select({ name: staffUsers.name })
        .from(staffUsers)
        .where(eq(staffUsers.id, by));
      await tx.insert(orgActions).values({
        id: uuidv7(),
        targetOrgId: refund.targetOrgId,
        kind: 'refund',
        summary: `Refund of A$${(refund.amountCents / 100).toFixed(2)} on invoice ${refund.invoiceRef} approved by ${approver?.name ?? 'a second approver'}`,
        customerSummary: `Archova staff recorded a refund of A$${(refund.amountCents / 100).toFixed(2)} on invoice ${refund.invoiceRef}.`,
        reason: refund.reason,
        ticketRef: refund.ticketRef,
        staffId: refund.requestedBy,
      });
      return { refundId: refund.id, amountCents: refund.amountCents };
    },
    release: async (d, ref, tx) => {
      const run = async (t: Tx) => {
        try {
          await d.adjustments.settleRefund(t, ref, 'cancelled', null, new Date());
        } catch (e) {
          // Already settled: nothing to release.
          if (!(e instanceof AppError)) throw e;
        }
      };
      if (tx) await run(tx);
      else await d.database.withGlobalTx('backoffice', run);
    },
  },
};

export function createRequestService(deps: RequestDeps) {
  const { database } = deps;
  const now = deps.now ?? (() => new Date());
  const tx = <T>(fn: Parameters<typeof database.withGlobalTx<T>>[1]) =>
    database.withGlobalTx('backoffice', fn);

  async function names(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await tx((t) =>
      t
        .select({ id: staffUsers.id, name: staffUsers.name })
        .from(staffUsers)
        .where(inArray(staffUsers.id, ids)),
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async function toDtos(rows: Array<typeof requests.$inferSelect>): Promise<RequestDto[]> {
    const n = await names(
      [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy]))].filter((x): x is string =>
        Boolean(x),
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as RequestKind,
      status: r.status as RequestStatus,
      subject: r.subjectLabel,
      reason: r.reason,
      preview: r.preview,
      requestedBy: { id: r.requestedBy, name: n.get(r.requestedBy) ?? 'Unknown' },
      approvedBy: r.approvedBy
        ? { id: r.approvedBy, name: n.get(r.approvedBy) ?? 'Unknown' }
        : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      executedAt: r.executedAt?.toISOString() ?? null,
      coolingOffUntil: r.coolingOffUntil?.toISOString() ?? null,
      result: r.result,
      orgId: r.targetOrgId,
    }));
  }

  async function create(
    staff: StaffContext,
    input: {
      kind: RequestKind;
      subjectRef: string;
      subjectLabel: string;
      reason: string;
      preview: Record<string, unknown> | null;
      orgId?: string;
      /** Replaces the solo-owner delay for this kind (a refund waits 1 hour, a publish 24). */
      coolingOffHours?: number;
    },
  ) {
    // Solo-owner mode: while the requester is the only person who could approve, they may approve their own
    // pricing change after a delay, and the delay is recorded on the request.
    const solo =
      staff.roles.includes('owner') && (await deps.staff.otherApprovers(staff.staffId)) === 0;
    const at = now();
    const id = uuidv7();
    await tx((t) =>
      t.insert(requests).values({
        id,
        kind: input.kind,
        subjectRef: input.subjectRef,
        subjectLabel: input.subjectLabel,
        reason: input.reason,
        preview: input.preview,
        targetOrgId: input.orgId ?? null,
        requestedBy: staff.staffId,
        soloOwnerMode: solo,
        coolingOffUntil: solo
          ? new Date(at.getTime() + (input.coolingOffHours ?? deps.soloCoolingOffHours) * 3_600_000)
          : null,
        createdAt: at,
      }),
    );
    return get(id);
  }

  async function get(id: string): Promise<RequestDto> {
    const [row] = await tx((t) => t.select().from(requests).where(eq(requests.id, id)));
    if (!row) throw new AppError('backoffice.request_not_found');
    return (await toDtos([row]))[0]!;
  }

  async function list(filter: { status?: RequestStatus; orgId?: string; limit: number }) {
    const rows = await tx((t) =>
      t
        .select()
        .from(requests)
        .where(
          and(
            filter.status ? eq(requests.status, filter.status) : undefined,
            filter.orgId ? eq(requests.targetOrgId, filter.orgId) : undefined,
          ),
        )
        .orderBy(desc(requests.createdAt))
        .limit(filter.limit),
    );
    return toDtos(rows);
  }

  /**
   * Approve and run. The requester cannot approve their own request, apart from solo-owner mode after its delay.
   * The step-up check is made by the caller; the request is claimed atomically so it can only run once.
   */
  async function approve(staff: StaffContext, id: string): Promise<RequestDto> {
    const [row] = await tx((t) => t.select().from(requests).where(eq(requests.id, id)));
    if (!row) throw new AppError('backoffice.request_not_found');
    if (row.status !== 'pending')
      throw new AppError('backoffice.request_not_pending', `The request is already ${row.status}.`);
    const kind = KINDS[row.kind as RequestKind];
    if (!staff.permissions.includes(kind.permission))
      throw new AppError('backoffice.permission_denied', 'Your role cannot approve this request.');
    const at = now();
    if (row.requestedBy === staff.staffId) {
      if (!row.soloOwnerMode)
        throw new AppError('backoffice.self_approval', 'A second person must approve this.');
      // Solo-owner mode was decided when the request was made; it holds only while nobody else could approve.
      if ((await deps.staff.otherApprovers(staff.staffId)) > 0)
        throw new AppError(
          'backoffice.self_approval',
          'Another approver now exists, so a second person must approve this.',
        );
      if (row.coolingOffUntil && row.coolingOffUntil > at)
        throw new AppError(
          'backoffice.cooling_off',
          `You can approve your own request after ${row.coolingOffUntil.toISOString()}.`,
          undefined,
          { coolingOffUntil: row.coolingOffUntil.toISOString() },
        );
    }
    // Claim, publish and mark executed commit together, so a request can never be left half-done. A failed
    // publish rolls back to a savepoint, then the draft is reopened and the request recorded as failed.
    const claimed = await tx(async (t) => {
      const got = await t
        .update(requests)
        .set({ status: 'approved', approvedBy: staff.staffId, decidedAt: at })
        .where(and(eq(requests.id, id), eq(requests.status, 'pending')))
        .returning({ id: requests.id });
      if (!got.length) return false;
      try {
        const result = await t.transaction((inner) =>
          kind.execute(deps, row.subjectRef, staff.staffId, at, inner as unknown as Tx),
        );
        await t
          .update(requests)
          .set({ status: 'executed', executedAt: now(), result })
          .where(eq(requests.id, id));
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        await kind.release(deps, row.subjectRef, t);
        await t
          .update(requests)
          .set({ status: 'failed', executedAt: now(), result: { error: e.message } })
          .where(eq(requests.id, id));
      }
      return true;
    });
    if (!claimed)
      throw new AppError('backoffice.request_not_pending', 'The request was just decided.');
    return get(id);
  }

  async function reject(staff: StaffContext, id: string, reason: string): Promise<RequestDto> {
    const row = await pendingRow(id);
    const kind = KINDS[row.kind as RequestKind];
    if (!staff.permissions.includes(kind.permission))
      throw new AppError('backoffice.permission_denied', 'Your role cannot decide this request.');
    if (row.requestedBy === staff.staffId)
      throw new AppError('backoffice.self_approval', 'Cancel your own request instead.');
    await close(row, 'rejected', staff.staffId, reason);
    return get(id);
  }

  /** The requester, or an Owner, withdraws a pending request; the draft becomes editable again. */
  async function cancel(staff: StaffContext, id: string): Promise<RequestDto> {
    const row = await pendingRow(id);
    if (row.requestedBy !== staff.staffId && !staff.roles.includes('owner'))
      throw new AppError(
        'backoffice.permission_denied',
        'Only the requester or an Owner can cancel.',
      );
    await close(row, 'cancelled', staff.staffId, null);
    return get(id);
  }

  async function pendingRow(id: string) {
    const [row] = await tx((t) => t.select().from(requests).where(eq(requests.id, id)));
    if (!row) throw new AppError('backoffice.request_not_found');
    if (row.status !== 'pending')
      throw new AppError('backoffice.request_not_pending', `The request is already ${row.status}.`);
    return row;
  }

  async function close(
    row: typeof requests.$inferSelect,
    status: 'rejected' | 'cancelled',
    by: string,
    reason: string | null,
  ) {
    const done = await tx((t) =>
      t
        .update(requests)
        .set({ status, decisionReason: reason, decidedAt: now(), approvedBy: null })
        .where(and(eq(requests.id, row.id), eq(requests.status, 'pending')))
        .returning({ id: requests.id }),
    );
    if (!done.length)
      throw new AppError('backoffice.request_not_pending', 'The request was just decided.');
    await KINDS[row.kind as RequestKind].release(deps, row.subjectRef);
    void by;
  }

  return { create, get, list, approve, reject, cancel };
}

export type RequestService = ReturnType<typeof createRequestService>;
