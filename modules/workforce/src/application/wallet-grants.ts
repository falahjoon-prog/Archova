// Wallet sharing (compliance/05, Sam's review of 4 Nov 2026): a builder requests access for a named project, the
// subbie accepts with the builder's share code, and the builder then reads the subbie's documents in its own
// tenant transaction. The database floor is org, item type and expiry (RLS); the project match is checked here.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf, type LocalDate } from '@archova/time';
import { canonicalJson, sha256 } from '../domain/induction';
import type { InductionDeps } from './inductions';
import {
  CODE_VALID_DAYS,
  SHAREABLE_ITEM_TYPES,
  expiryState,
  grantLive,
  maxGrantExpiry,
} from '../domain/wallet';
import {
  complianceAccessLog,
  complianceAccessRequests,
  complianceDocuments,
  complianceGrants,
  complianceRelianceSnapshots,
} from '../infra/tables';
import { WALLET_TIME_ZONE } from './wallet';

export type GrantRow = typeof complianceGrants.$inferSelect;
export type AccessRequestRow = typeof complianceAccessRequests.$inferSelect;
export type DocumentRow = typeof complianceDocuments.$inferSelect;

export interface RequestInput {
  projectId?: string;
  allProjects: boolean;
  itemTypes: string[];
  expiresOn?: string;
}

/** What a builder sees of a subbie's document: never files, ids of people or the full number. */
export function sharedDocument(d: DocumentRow, today: LocalDate) {
  return {
    id: d.id,
    itemType: d.itemType,
    title: d.title,
    numberLast4: d.numberLast4,
    issuingState: d.issuingState,
    licenceClass: d.licenceClass,
    insurer: d.insurer,
    limitCents: d.limitCents,
    startsOn: d.startsOn,
    expiresOn: d.expiresOn,
    evidence: d.evidence,
    expiry: expiryState(d.expiresOn, today),
    sightedAt: d.sightedAt ? d.sightedAt.toISOString() : null,
    fileCount: d.fileIds.length,
  };
}
export type SharedDocument = ReturnType<typeof sharedDocument>;

const FILE_URL_TTL_S = 60;

const hashCode = (code: string) => sha256(code.trim());

export function createWalletGrantService(deps: {
  access: Pick<AccessService, 'assert'>;
  platform: Pick<PlatformApi, 'getOrg' | 'getProject'>;
  files: Pick<InductionDeps['files'], 'downloadUrl'>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const today = () => localDateOf(now(), WALLET_TIME_ZONE);

  const normaliseTypes = (types: string[]) => {
    const set = [...new Set(types)];
    const bad = set.find((t) => !(SHAREABLE_ITEM_TYPES as readonly string[]).includes(t));
    if (bad || set.length === 0)
      throw new AppError('validation_failed', 'Choose the document types to ask for.', [
        {
          path: 'itemTypes',
          message: bad ? `${bad} can't be shared` : 'At least one type is required',
        },
      ]);
    return set;
  };

  // ------------------------------------------------------------------ builder: requests and reading

  /** The share code is returned once; only its hash is stored. */
  async function createRequest(scope: TenantScope, input: RequestInput) {
    if (input.allProjects === !!input.projectId)
      throw new AppError(
        'validation_failed',
        'Name a project, or choose all projects explicitly (not both).',
        [{ path: 'projectId', message: 'Give a project, or set allProjects' }],
      );
    const todayDate = today();
    const max = maxGrantExpiry(todayDate);
    const expiresOn = input.expiresOn ?? max;
    if (expiresOn < todayDate || expiresOn > max)
      throw new AppError('validation_failed', 'Access can last up to 12 months.', [
        { path: 'expiresOn', message: `Between ${todayDate} and ${max}` },
      ]);
    const org = await deps.platform.getOrg(scope);
    const project = input.projectId ? await deps.platform.getProject(scope, input.projectId) : null;
    const code = `wlt_${randomBytes(16).toString('base64url')}`;
    const [row] = await scope.tx
      .insert(complianceAccessRequests)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        requesterName: org.name,
        projectId: input.projectId ?? null,
        projectName: project?.name ?? null,
        allProjects: input.allProjects,
        itemTypes: normaliseTypes(input.itemTypes),
        grantExpiresOn: expiresOn,
        codeHash: hashCode(code),
        codeExpiresAt: new Date(now().getTime() + CODE_VALID_DAYS * 86_400_000),
        status: 'requested',
        createdBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'workforce.compliance_access_request.created.v1',
      projectId: input.projectId ?? null,
      entityType: 'compliance_access_request',
      entityId: row!.id,
      data: {
        itemTypes: row!.itemTypes,
        projectId: row!.projectId,
        allProjects: row!.allProjects,
        expiresOn,
      },
    });
    return { row: row!, code };
  }

  async function listRequests(scope: TenantScope) {
    return scope.tx
      .select()
      .from(complianceAccessRequests)
      .where(eq(complianceAccessRequests.orgId, scope.ctx.orgId))
      .orderBy(desc(complianceAccessRequests.createdAt));
  }

  async function cancelRequest(scope: TenantScope, id: string, expected: number) {
    const [cur] = await scope.tx
      .select()
      .from(complianceAccessRequests)
      .where(
        and(
          eq(complianceAccessRequests.id, id),
          eq(complianceAccessRequests.orgId, scope.ctx.orgId),
        ),
      )
      .limit(1);
    if (!cur) throw new AppError('compliance_grant.not_found');
    if (cur.version !== expected) throw versionConflict();
    if (cur.status !== 'requested')
      throw new AppError('validation_failed', 'Only an open request can be cancelled.');
    const [row] = await scope.tx
      .update(complianceAccessRequests)
      .set({ status: 'cancelled', version: cur.version + 1, updatedAt: now() })
      .where(
        and(eq(complianceAccessRequests.id, id), eq(complianceAccessRequests.version, expected)),
      )
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  /** Live grants this org holds, soonest expiry first. */
  async function listGranted(scope: TenantScope) {
    const rows = await scope.tx
      .select()
      .from(complianceGrants)
      .where(eq(complianceGrants.granteeOrgId, scope.ctx.orgId))
      .orderBy(complianceGrants.expiresOn);
    const t = today();
    return { rows: rows.filter((g) => grantLive(g, t)), today: t };
  }

  /** The grant a builder reads through: its own, live, and covering the project it names. 404 otherwise. */
  async function liveGrantFor(scope: TenantScope, grantId: string, projectId: string) {
    // The project must be one of this builder's own (RLS scopes the lookup to its org) and the caller must run
    // sites on it, whatever the grant says; an all-projects grant never lets a made-up id through.
    await deps.platform.getProject(scope, projectId);
    await deps.access.assert(scope, 'workforce.attendance.manage', { projectId });
    const [g] = await scope.tx
      .select()
      .from(complianceGrants)
      .where(
        and(eq(complianceGrants.id, grantId), eq(complianceGrants.granteeOrgId, scope.ctx.orgId)),
      )
      .limit(1);
    if (!g || !grantLive(g, today()) || !(g.allProjects || g.projectId === projectId))
      throw new AppError('compliance_grant.not_found');
    return g;
  }

  /** Fails closed: a read the subbie can't see in its log doesn't happen. */
  async function logView(
    scope: TenantScope,
    g: GrantRow,
    kind: 'list' | 'document' | 'file',
    doc?: { id: string; itemType: string },
    fileId?: string,
  ) {
    const org = await deps.platform.getOrg(scope);
    await scope.tx.insert(complianceAccessLog).values({
      id: uuidv7(),
      orgId: g.orgId,
      grantId: g.id,
      granteeOrgId: scope.ctx.orgId,
      granteeName: org.name,
      documentId: doc?.id ?? null,
      itemType: doc?.itemType ?? null,
      fileId: fileId ?? null,
      kind,
    });
  }

  async function documentsFor(scope: TenantScope, g: GrantRow) {
    // The documents policy only lets a builder see a subbie's rows for the one grant named here, so nothing else in
    // this transaction (the builder's own wallet queries, say) can see them. Set after the grant has been checked.
    await scope.tx.execute(sql`select set_config('app.wallet_grant', ${g.id}, true)`);
    // RLS is the floor; the filters repeat what the grant covers so the intent is readable.
    return scope.tx
      .select()
      .from(complianceDocuments)
      .where(
        and(
          eq(complianceDocuments.orgId, g.orgId),
          inArray(complianceDocuments.itemType, g.itemTypes),
        ),
      )
      .orderBy(sql`${complianceDocuments.expiresOn} asc nulls last`);
  }

  async function listGrantedDocuments(scope: TenantScope, grantId: string, projectId: string) {
    const g = await liveGrantFor(scope, grantId, projectId);
    const docs = await documentsFor(scope, g);
    if (docs.length === 0) await logView(scope, g, 'list');
    for (const d of docs) await logView(scope, g, 'document', d);
    scope.events.add({
      type: 'workforce.compliance_grant.viewed.v1',
      projectId,
      entityType: 'compliance_grant',
      entityId: g.id,
      data: {
        grantId: g.id,
        subbieOrgId: g.orgId,
        itemTypes: [...new Set(docs.map((d) => d.itemType))],
      },
    });
    return { grant: g, documents: docs.map((d) => sharedDocument(d, today())) };
  }

  /**
   * A short-lived download link for one file of a shared document (compliance/05 §7). The grant is checked, the file
   * must be one of that document's files, and the subbie's log row is written before anything is signed, so a view
   * that can't be logged returns nothing. Only the URL is returned, never the storage key.
   */
  async function fileUrl(
    scope: TenantScope,
    grantId: string,
    projectId: string,
    documentId: string,
    position: number,
  ) {
    const g = await liveGrantFor(scope, grantId, projectId);
    const doc = (await documentsFor(scope, g)).find((d) => d.id === documentId);
    const fileId = doc?.fileIds[position - 1];
    if (!doc || !fileId) throw new AppError('compliance_document.not_found');
    // The files policy needs this one file as well as the grant; nothing else in the transaction can see it.
    await scope.tx.execute(sql`select set_config('app.wallet_file', ${fileId}, true)`);
    await logView(scope, g, 'file', doc, fileId);
    const link = await deps.files
      .downloadUrl(scope, fileId, {
        authorised: true,
        expiresInS: FILE_URL_TTL_S,
        // With the attachment disposition this stops a browser sniffing the bytes into something it would render.
        contentType: 'application/octet-stream',
      })
      .catch(() => {
        throw new AppError('compliance_document.not_found');
      });
    scope.events.add({
      type: 'workforce.compliance_file.viewed.v1',
      projectId,
      entityType: 'compliance_grant',
      entityId: g.id,
      data: { grantId: g.id, subbieOrgId: g.orgId, documentId: doc.id, itemType: doc.itemType },
    });
    return link;
  }

  /** The builder's record of a document it relied on: the DTO and its SHA-256, never files. */
  async function createSnapshot(
    scope: TenantScope,
    grantId: string,
    projectId: string,
    documentId: string,
    reason: 'site_entry' | 'claim_assessment' | 'other',
  ) {
    const g = await liveGrantFor(scope, grantId, projectId);
    const doc = (await documentsFor(scope, g)).find((d) => d.id === documentId);
    if (!doc) throw new AppError('compliance_document.not_found');
    await logView(scope, g, 'document', doc);
    const dto = sharedDocument(doc, today());
    const [row] = await scope.tx
      .insert(complianceRelianceSnapshots)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        grantId: g.id,
        subbieOrgId: g.orgId,
        subbieName: g.grantorName,
        documentId: doc.id,
        itemType: doc.itemType,
        projectId,
        reason,
        dto,
        sha256: sha256(canonicalJson(dto)),
        createdBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'workforce.compliance_snapshot.created.v1',
      projectId,
      entityType: 'compliance_snapshot',
      entityId: row!.id,
      data: { grantId: g.id, itemType: doc.itemType, reason },
    });
    return row!;
  }

  // ------------------------------------------------------------------ subbie: redeem, list, revoke, log

  /** Looks up the open request for a code. One answer for wrong, expired, used or cancelled codes. */
  async function openRequest(scope: TenantScope, code: string) {
    const h = hashCode(code);
    await scope.tx.execute(sql`select set_config('app.compliance_code_hash', ${h}, true)`);
    const [r] = await scope.tx
      .select()
      .from(complianceAccessRequests)
      .where(eq(complianceAccessRequests.codeHash, h))
      .limit(1);
    // A subbie can't redeem its own request.
    if (!r || r.orgId === scope.ctx.orgId || r.status !== 'requested' || r.codeExpiresAt <= now())
      throw new AppError('compliance_code.invalid');
    return r;
  }

  async function previewCode(scope: TenantScope, code: string) {
    return openRequest(scope, code);
  }

  async function acceptCode(scope: TenantScope, code: string) {
    const r = await openRequest(scope, code);
    const org = await deps.platform.getOrg(scope);
    const at = now();
    // Claim the request first, and require that this statement changed one row: of two concurrent redemptions
    // the second waits on the row lock, re-reads it as accepted and matches nothing.
    const claimed = await scope.tx
      .update(complianceAccessRequests)
      .set({
        status: 'accepted',
        acceptedOrgId: scope.ctx.orgId,
        acceptedAt: at,
        version: r.version + 1,
        updatedAt: at,
      })
      .where(
        and(
          eq(complianceAccessRequests.id, r.id),
          eq(complianceAccessRequests.status, 'requested'),
          eq(complianceAccessRequests.version, r.version),
        ),
      )
      .returning({ id: complianceAccessRequests.id });
    if (claimed.length !== 1) throw new AppError('compliance_code.invalid');
    const [g] = await scope.tx
      .insert(complianceGrants)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        granteeOrgId: r.orgId,
        granteeName: r.requesterName,
        grantorName: org.name,
        requestId: r.id,
        itemTypes: r.itemTypes,
        projectId: r.projectId,
        projectName: r.projectName,
        allProjects: r.allProjects,
        expiresOn: r.grantExpiresOn,
        acceptedBy: scope.ctx.userId,
        acceptedAt: at,
      })
      .returning();
    scope.events.add({
      type: 'workforce.compliance_grant.accepted.v1',
      projectId: r.projectId,
      entityType: 'compliance_grant',
      entityId: g!.id,
      data: {
        granteeOrgId: r.orgId,
        itemTypes: r.itemTypes,
        projectId: r.projectId,
        allProjects: r.allProjects,
        expiresOn: r.grantExpiresOn,
      },
    });
    return g!;
  }

  async function listGrants(scope: TenantScope) {
    const rows = await scope.tx
      .select()
      .from(complianceGrants)
      .where(eq(complianceGrants.orgId, scope.ctx.orgId))
      .orderBy(desc(complianceGrants.createdAt));
    return { rows, today: today() };
  }

  async function revokeGrant(scope: TenantScope, id: string, expected: number) {
    const [cur] = await scope.tx
      .select()
      .from(complianceGrants)
      .where(and(eq(complianceGrants.id, id), eq(complianceGrants.orgId, scope.ctx.orgId)))
      .limit(1);
    if (!cur) throw new AppError('compliance_grant.not_found');
    if (cur.version !== expected) throw versionConflict();
    if (cur.revokedAt) return { row: cur, today: today() };
    const at = now();
    const [row] = await scope.tx
      .update(complianceGrants)
      .set({
        revokedAt: at,
        revokedBy: scope.ctx.userId,
        version: cur.version + 1,
        updatedAt: at,
      })
      .where(and(eq(complianceGrants.id, id), eq(complianceGrants.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'workforce.compliance_grant.revoked.v1',
      projectId: row.projectId,
      entityType: 'compliance_grant',
      entityId: row.id,
      data: {
        granteeOrgId: row.granteeOrgId,
        itemTypes: row.itemTypes,
        projectId: row.projectId,
        allProjects: row.allProjects,
        expiresOn: row.expiresOn,
      },
    });
    return { row, today: today() };
  }

  async function accessLog(scope: TenantScope, limit = 100) {
    return scope.tx
      .select()
      .from(complianceAccessLog)
      .where(eq(complianceAccessLog.orgId, scope.ctx.orgId))
      .orderBy(desc(complianceAccessLog.at))
      .limit(Math.min(limit, 200));
  }

  return {
    createRequest,
    listRequests,
    cancelRequest,
    listGranted,
    listGrantedDocuments,
    fileUrl,
    createSnapshot,
    previewCode,
    acceptCode,
    listGrants,
    revokeGrant,
    accessLog,
  };
}

export type WalletGrantService = ReturnType<typeof createWalletGrantService>;
