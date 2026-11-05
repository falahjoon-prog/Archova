// Subcontractor compliance wallet, first slice (compliance/05): a company's own documents.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import type { NumberVault } from '../domain/number-vault';
import { checkNumber, hasNumberCheck, isWorkerItem, last4 } from '../domain/wallet';
import {
  attendanceSessions,
  complianceDocuments,
  complianceExpiryAlerts,
  workers,
} from '../infra/tables';
import type { InductionDeps } from './inductions';

export type ComplianceDocumentRow = typeof complianceDocuments.$inferSelect;
/** A wallet row with what a per-worker item needs beside it: the holder's name and last sign-in day. */
export type WalletDoc = ComplianceDocumentRow & {
  lastSignInOn: string | null;
};
export type ComplianceAlertRow = {
  alert: typeof complianceExpiryAlerts.$inferSelect;
  title: string;
  itemType: string;
  archivedAt: Date | null;
};

/** Orgs carry no time zone yet; expiry follows the Sydney calendar day until they do. */
export const WALLET_TIME_ZONE = 'Australia/Sydney';

export interface WalletCreate {
  itemType: string;
  title: string;
  number?: string;
  issuingState?: string;
  licenceClass?: string;
  insurer?: string;
  limitCents?: number;
  startsOn?: string;
  expiresOn?: string;
  fileIds: string[];
  selfDeclared: boolean;
  /** Per-worker items only: who holds the card, and optionally their entry on this org's worker list. */
  holderName?: string;
  workerId?: string;
  /** White card only: the day the holder last did construction work. */
  lastWorkOn?: string;
}

export interface WalletUpdate {
  title?: string;
  number?: string | null;
  issuingState?: string | null;
  licenceClass?: string | null;
  insurer?: string | null;
  limitCents?: number | null;
  startsOn?: string | null;
  expiresOn?: string | null;
  fileIds?: string[];
  lastWorkOn?: string | null;
  archived?: boolean;
}

const unique = (ids: string[]) => [...new Set(ids)];

export function createWalletService(deps: { files: InductionDeps['files']; vault: NumberVault }) {
  /** The full number, sealed to this org and row; null when there is none. */
  const sealNumber = (orgId: string, id: string, n: string | null | undefined) => {
    const t = n?.trim();
    return t ? deps.vault.seal(orgId, 'wallet-document-number', id, t) : null;
  };

  /** Audit trail: ids and item type only, never the number or file names. */
  const audit = (
    scope: TenantScope,
    action: 'created' | 'updated' | 'archived' | 'unarchived' | 'sighted',
    row: ComplianceDocumentRow,
  ) =>
    scope.events.add({
      type: `workforce.compliance_document.${action}.v1`,
      entityType: 'compliance_document',
      entityId: row.id,
      entityVersion: row.version,
      data: { itemType: row.itemType, actorId: scope.ctx.userId },
    });

  const today = () => localDateOf(new Date(), WALLET_TIME_ZONE);

  /** The last sign-in day of linked workers, in one query however many rows there are. */
  async function withWorkers(
    scope: TenantScope,
    rows: ComplianceDocumentRow[],
  ): Promise<WalletDoc[]> {
    const ids = [...new Set(rows.flatMap((r) => (r.workerId ? [r.workerId] : [])))];
    const signIns = ids.length
      ? await scope.tx
          .select({
            workerId: attendanceSessions.workerId,
            last: sql<string>`max(${attendanceSessions.localDate})::text`,
          })
          .from(attendanceSessions)
          .where(
            and(
              inArray(attendanceSessions.workerId, ids),
              eq(attendanceSessions.orgId, scope.ctx.orgId),
            ),
          )
          .groupBy(attendanceSessions.workerId)
      : [];
    const last = new Map(signIns.map((n) => [n.workerId, n.last]));
    return rows.map((r) => ({
      ...r,
      lastSignInOn: r.workerId ? (last.get(r.workerId) ?? null) : null,
    }));
  }

  /** A per-worker item names its holder; a company item has none. A linked worker must be on this org's list. */
  async function assertHolder(
    scope: TenantScope,
    itemType: string,
    holderName?: string,
    workerId?: string,
  ) {
    if (!isWorkerItem(itemType)) {
      if (holderName || workerId)
        throw new AppError('validation_failed', 'This item belongs to the company, not a worker.', [
          {
            path: holderName ? 'holderName' : 'workerId',
            message: 'Leave empty for a company item',
          },
        ]);
      return;
    }
    if (!holderName?.trim())
      throw new AppError('validation_failed', 'Say whose card this is.', [
        { path: 'holderName', message: 'Required for a worker item' },
      ]);
    if (!workerId) return;
    const [w] = await scope.tx
      .select({ id: workers.id })
      .from(workers)
      .where(
        and(
          eq(workers.id, workerId),
          eq(workers.orgId, scope.ctx.orgId),
          eq(workers.kind, 'worker'),
        ),
      )
      .limit(1);
    if (!w)
      throw new AppError('validation_failed', 'That worker is not on this company’s list.', [
        { path: 'workerId', message: 'Not a worker in this organisation' },
      ]);
  }

  function assertLastWork(itemType: string, lastWorkOn?: string | null) {
    if (!lastWorkOn) return;
    if (itemType !== 'white_card')
      throw new AppError(
        'validation_failed',
        'Only a white card has a last construction work date.',
        [{ path: 'lastWorkOn', message: 'Only for a white card' }],
      );
    if (lastWorkOn > today())
      throw new AppError('validation_failed', 'The last work date is in the future.', [
        { path: 'lastWorkOn', message: 'Must not be in the future' },
      ]);
  }

  /** Org-level, scanned and ready: the wallet never points at a project's files. */
  async function assertFiles(scope: TenantScope, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId).catch(() => null);
      if (!f || f.projectId !== null || f.status !== 'ready')
        throw new AppError('validation_failed', 'Upload the file to the organisation first.', [
          { path: `fileIds/${i}`, message: 'Not a ready organisation file' },
        ]);
    }
  }

  function assertDates(startsOn?: string | null, expiresOn?: string | null) {
    if (startsOn && expiresOn && startsOn > expiresOn)
      throw new AppError('validation_failed', 'The expiry is before the start.', [
        { path: 'expiresOn', message: 'Must not be before startsOn' },
      ]);
  }

  /** Format check on the number as typed; it is the only time the full number is available. */
  function assertNumber(
    itemType: string,
    state: string | null | undefined,
    number?: string | null,
  ) {
    if (!number) return;
    const check = checkNumber(itemType, state, number);
    if (!check.ok)
      throw new AppError('validation_failed', check.message ?? 'Check the number.', [
        { path: 'number', message: check.message ?? 'Check the number' },
      ]);
  }

  async function list(scope: TenantScope, opts: { itemType?: string; includeArchived?: boolean }) {
    const rows = await scope.tx
      .select()
      .from(complianceDocuments)
      .where(
        and(
          eq(complianceDocuments.orgId, scope.ctx.orgId),
          opts.itemType ? eq(complianceDocuments.itemType, opts.itemType) : undefined,
          opts.includeArchived ? undefined : isNull(complianceDocuments.archivedAt),
        ),
      )
      // Soonest expiry first; documents that never expire last.
      .orderBy(
        sql`${complianceDocuments.expiresOn} asc nulls last`,
        asc(complianceDocuments.createdAt),
      );
    return { rows: await withWorkers(scope, rows), today: today() };
  }

  /** Expiry alerts the daily job has raised, newest first, with the document each is about. */
  async function listAlerts(scope: TenantScope, limit = 100) {
    const rows = await scope.tx
      .select({
        alert: complianceExpiryAlerts,
        title: complianceDocuments.title,
        itemType: complianceDocuments.itemType,
        archivedAt: complianceDocuments.archivedAt,
      })
      .from(complianceExpiryAlerts)
      .innerJoin(
        complianceDocuments,
        and(
          eq(complianceDocuments.id, complianceExpiryAlerts.documentId),
          eq(complianceDocuments.orgId, scope.ctx.orgId),
        ),
      )
      .orderBy(desc(complianceExpiryAlerts.raisedOn), asc(complianceExpiryAlerts.threshold))
      .limit(limit);
    return { rows, today: today() };
  }

  async function create(scope: TenantScope, raw: WalletCreate) {
    const input = { ...raw, fileIds: unique(raw.fileIds) };
    assertDates(input.startsOn, input.expiresOn);
    assertNumber(input.itemType, input.issuingState, input.number);
    await assertHolder(scope, input.itemType, input.holderName, input.workerId);
    assertLastWork(input.itemType, input.lastWorkOn);
    if (input.selfDeclared && input.fileIds.length > 0)
      throw new AppError('validation_failed', 'A declaration has no files.', [
        { path: 'fileIds', message: 'Leave empty for a self-declared item' },
      ]);
    if (!input.selfDeclared && input.fileIds.length === 0)
      throw new AppError('validation_failed', 'Attach the document, or mark it as a declaration.', [
        { path: 'fileIds', message: 'At least one file is required' },
      ]);
    await assertFiles(scope, input.fileIds);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(complianceDocuments)
      .values({
        id,
        orgId: scope.ctx.orgId,
        itemType: input.itemType,
        title: input.title.trim(),
        numberLast4: last4(input.number),
        numberSealed: sealNumber(scope.ctx.orgId, id, input.number),
        numberCheck: input.number && hasNumberCheck(input.itemType) ? ('format_ok' as const) : null,
        issuingState: input.issuingState ?? null,
        licenceClass: input.licenceClass?.trim() || null,
        insurer: input.insurer?.trim() || null,
        limitCents: input.limitCents ?? null,
        startsOn: input.startsOn ?? null,
        expiresOn: input.expiresOn ?? null,
        fileIds: input.fileIds,
        holderName: input.holderName?.trim() || null,
        workerId: input.workerId ?? null,
        lastWorkDeclaredOn: input.lastWorkOn ?? null,
        evidence: input.selfDeclared ? 'self_declared' : 'recorded',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    audit(scope, 'created', row!);
    await retain(scope, row!);
    return { row: (await withWorkers(scope, [row!]))[0]!, today: today() };
  }

  /**
   * Kept 7 years after expiry or last use (compliance/05 §7). Each change re-tags, which only ever extends the period,
   * so a later expiry date lengthens it and an earlier one cannot shorten it.
   */
  async function retain(scope: TenantScope, row: ComplianceDocumentRow) {
    const anchor = new Date(
      Math.max(row.updatedAt.getTime(), Date.parse(`${row.expiresOn ?? ''}T00:00:00Z`) || 0),
    );
    await recordRetention(scope, {
      recordType: 'workforce.compliance_documents',
      recordId: row.id,
      category: 'wallet_document_7y',
      // The kernel rejects an anchor over 5 years out; a longer-dated expiry is picked up by the next change.
      anchor: new Date(Math.min(anchor.getTime(), Date.now() + 4 * 365 * 86_400_000)),
    });
  }

  async function load(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select()
      .from(complianceDocuments)
      .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.orgId, scope.ctx.orgId)))
      .limit(1);
    if (!row) throw new AppError('compliance_document.not_found');
    return row;
  }

  async function update(scope: TenantScope, id: string, expected: number, input: WalletUpdate) {
    const cur = await load(scope, id);
    if (cur.version !== expected) throw versionConflict();
    const content = {
      title: input.title?.trim() ?? cur.title,
      numberLast4: input.number === undefined ? cur.numberLast4 : last4(input.number),
      // A new number reaching here passed assertNumber below; clearing it clears the check.
      numberCheck:
        input.number === undefined
          ? cur.numberCheck
          : input.number && hasNumberCheck(cur.itemType)
            ? ('format_ok' as const)
            : null,
      issuingState: input.issuingState === undefined ? cur.issuingState : input.issuingState,
      licenceClass:
        input.licenceClass === undefined ? cur.licenceClass : input.licenceClass?.trim() || null,
      insurer: input.insurer === undefined ? cur.insurer : input.insurer?.trim() || null,
      limitCents: input.limitCents === undefined ? cur.limitCents : input.limitCents,
      startsOn: input.startsOn === undefined ? cur.startsOn : input.startsOn,
      expiresOn: input.expiresOn === undefined ? cur.expiresOn : input.expiresOn,
      fileIds: input.fileIds ? unique(input.fileIds) : cur.fileIds,
    };
    assertDates(content.startsOn, content.expiresOn);
    assertNumber(cur.itemType, content.issuingState, input.number);
    assertLastWork(cur.itemType, input.lastWorkOn);
    // The holder's declaration is not on the card, so changing it never clears a sighting.
    const lastWork = input.lastWorkOn === undefined ? cur.lastWorkDeclaredOn : input.lastWorkOn;
    if (input.fileIds) await assertFiles(scope, content.fileIds);
    if (cur.evidence !== 'self_declared' && content.fileIds.length === 0)
      throw new AppError('validation_failed', 'A document needs at least one file.', [
        { path: 'fileIds', message: 'At least one file is required' },
      ]);
    // Changing what the document says means nobody has sighted this version of it.
    const changed =
      JSON.stringify({ ...content, fileIds: [...content.fileIds].sort() }) !==
      JSON.stringify({
        title: cur.title,
        numberLast4: cur.numberLast4,
        numberCheck: cur.numberCheck,
        issuingState: cur.issuingState,
        licenceClass: cur.licenceClass,
        insurer: cur.insurer,
        limitCents: cur.limitCents,
        startsOn: cur.startsOn,
        expiresOn: cur.expiresOn,
        fileIds: [...cur.fileIds].sort(),
      });
    const resighted = changed && cur.evidence === 'sighted';
    const at = new Date();
    const [row] = await scope.tx
      .update(complianceDocuments)
      .set({
        ...content,
        // Outside `content`: a fresh seal differs every time, so it must not read as the document having changed.
        numberSealed:
          input.number === undefined
            ? cur.numberSealed
            : sealNumber(scope.ctx.orgId, cur.id, input.number),
        lastWorkDeclaredOn: lastWork,
        ...(resighted ? { evidence: 'recorded' as const, sightedBy: null, sightedAt: null } : {}),
        ...(input.archived === undefined
          ? {}
          : { archivedAt: input.archived ? (cur.archivedAt ?? at) : null }),
        version: cur.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    if (input.archived !== undefined && input.archived !== (cur.archivedAt !== null))
      audit(scope, input.archived ? 'archived' : 'unarchived', row);
    if (changed || lastWork !== cur.lastWorkDeclaredOn) audit(scope, 'updated', row);
    await retain(scope, row);
    return { row: (await withWorkers(scope, [row]))[0]!, today: today() };
  }

  async function sight(scope: TenantScope, id: string, expected: number) {
    const cur = await load(scope, id);
    if (cur.version !== expected) throw versionConflict();
    if (cur.evidence === 'self_declared')
      throw new AppError('validation_failed', 'A declaration has no document to sight.');
    const at = new Date();
    const [row] = await scope.tx
      .update(complianceDocuments)
      .set({
        evidence: 'sighted',
        sightedBy: scope.ctx.userId,
        sightedAt: at,
        version: cur.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    audit(scope, 'sighted', row);
    await retain(scope, row);
    return { row: (await withWorkers(scope, [row]))[0]!, today: today() };
  }

  return { list, listAlerts, create, update, sight };
}

export type WalletService = ReturnType<typeof createWalletService>;
