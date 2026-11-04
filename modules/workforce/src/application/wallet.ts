// Subcontractor compliance wallet, first slice (compliance/05): a company's own documents.
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { checkNumber, hasNumberCheck, last4 } from '../domain/wallet';
import { complianceDocuments, complianceExpiryAlerts } from '../infra/tables';
import type { InductionDeps } from './inductions';

export type ComplianceDocumentRow = typeof complianceDocuments.$inferSelect;
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
  archived?: boolean;
}

const unique = (ids: string[]) => [...new Set(ids)];

export function createWalletService(deps: { files: InductionDeps['files'] }) {
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
          opts.itemType ? eq(complianceDocuments.itemType, opts.itemType) : undefined,
          opts.includeArchived ? undefined : isNull(complianceDocuments.archivedAt),
        ),
      )
      // Soonest expiry first; documents that never expire last.
      .orderBy(
        sql`${complianceDocuments.expiresOn} asc nulls last`,
        asc(complianceDocuments.createdAt),
      );
    return { rows, today: today() };
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
      .innerJoin(complianceDocuments, eq(complianceDocuments.id, complianceExpiryAlerts.documentId))
      .orderBy(desc(complianceExpiryAlerts.raisedOn), asc(complianceExpiryAlerts.threshold))
      .limit(limit);
    return { rows, today: today() };
  }

  async function create(scope: TenantScope, raw: WalletCreate) {
    const input = { ...raw, fileIds: unique(raw.fileIds) };
    assertDates(input.startsOn, input.expiresOn);
    assertNumber(input.itemType, input.issuingState, input.number);
    if (input.selfDeclared && input.fileIds.length > 0)
      throw new AppError('validation_failed', 'A declaration has no files.', [
        { path: 'fileIds', message: 'Leave empty for a self-declared item' },
      ]);
    if (!input.selfDeclared && input.fileIds.length === 0)
      throw new AppError('validation_failed', 'Attach the document, or mark it as a declaration.', [
        { path: 'fileIds', message: 'At least one file is required' },
      ]);
    await assertFiles(scope, input.fileIds);
    const [row] = await scope.tx
      .insert(complianceDocuments)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        itemType: input.itemType,
        title: input.title.trim(),
        numberLast4: last4(input.number),
        numberCheck: input.number && hasNumberCheck(input.itemType) ? ('format_ok' as const) : null,
        issuingState: input.issuingState ?? null,
        licenceClass: input.licenceClass?.trim() || null,
        insurer: input.insurer?.trim() || null,
        limitCents: input.limitCents ?? null,
        startsOn: input.startsOn ?? null,
        expiresOn: input.expiresOn ?? null,
        fileIds: input.fileIds,
        evidence: input.selfDeclared ? 'self_declared' : 'recorded',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    audit(scope, 'created', row!);
    return { row: row!, today: today() };
  }

  async function load(scope: TenantScope, id: string) {
    const [row] = await scope.tx
      .select()
      .from(complianceDocuments)
      .where(eq(complianceDocuments.id, id))
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
    if (changed) audit(scope, 'updated', row);
    return { row, today: today() };
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
    return { row, today: today() };
  }

  return { list, listAlerts, create, update, sight };
}

export type WalletService = ReturnType<typeof createWalletService>;
