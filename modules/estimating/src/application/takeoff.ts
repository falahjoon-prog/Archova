import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import type { DocumentsApi } from '@archova/mod-documents';
import {
  confirmedOnCreate,
  measurementProblem,
  type Geometry,
  type MeasurementKind,
  type MeasurementSource,
} from '../domain/takeoff';
import { takeoffMeasurements, tenderPackages } from '../infra/tables';

export type MeasurementRow = typeof takeoffMeasurements.$inferSelect;

export interface TakeoffDeps {
  documents: Pick<DocumentsApi, 'getDrawingRevision'>;
  now?: () => Date;
}

export interface MeasurementFields {
  label?: string;
  geometry?: Geometry;
  quantity?: string;
  unit?: string;
  confidence?: number | null;
  packageId?: string | null;
  scopeKey?: string | null;
}

export interface MeasurementCreate extends MeasurementFields {
  revisionId: string;
  kind: MeasurementKind;
  source: Exclude<MeasurementSource, 'auto'>;
  label: string;
  geometry: Geometry;
  quantity: string;
  unit: string;
}

export function createTakeoffService(deps: TakeoffDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(takeoffMeasurements)
      .where(
        and(
          eq(takeoffMeasurements.id, id),
          eq(takeoffMeasurements.projectId, projectId),
          isNull(takeoffMeasurements.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('takeoff.not_found');
    return row;
  }

  /** The package must be on this project, and a scope key must be one of its scope lines. */
  async function checkLink(
    scope: TenantScope,
    projectId: string,
    packageId: string | null,
    scopeKey: string | null,
  ) {
    if (scopeKey && !packageId)
      throw new AppError('takeoff.invalid', 'A scope line needs its tender package.', [
        { path: 'scopeKey', message: 'Give the packageId this scope line belongs to' },
      ]);
    if (!packageId) return;
    const [pkg] = await scope.tx
      .select({ scope: tenderPackages.scope })
      .from(tenderPackages)
      .where(
        and(
          eq(tenderPackages.id, packageId),
          eq(tenderPackages.projectId, projectId),
          isNull(tenderPackages.deletedAt),
        ),
      )
      .limit(1);
    if (!pkg) throw new AppError('tender.not_found');
    if (scopeKey && !pkg.scope.some((s) => s.key === scopeKey))
      throw new AppError('takeoff.invalid', 'That package has no such scope line.', [
        { path: 'scopeKey', message: 'Not a scope line on this package' },
      ]);
  }

  function check(kind: MeasurementKind, geometry: Geometry, quantity: string) {
    const problem = measurementProblem(kind, geometry, Number(quantity));
    if (problem)
      throw new AppError('takeoff.invalid', 'This measurement does not add up.', [problem]);
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      revisionId?: string;
      packageId?: string;
      confirmed?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const t = takeoffMeasurements;
    const conditions = [eq(t.projectId, projectId), isNull(t.deletedAt)];
    if (opts.revisionId) conditions.push(eq(t.revisionId, opts.revisionId));
    if (opts.packageId) conditions.push(eq(t.packageId, opts.packageId));
    if (opts.confirmed !== undefined)
      conditions.push(opts.confirmed ? isNotNull(t.confirmedAt) : isNull(t.confirmedAt));
    if (after) conditions.push(lt(t.id, after.id));
    const rows = await scope.tx
      .select()
      .from(t)
      .where(and(...conditions))
      .orderBy(desc(t.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function assertRevision(scope: TenantScope, projectId: string, revisionId: string) {
    try {
      await deps.documents.getDrawingRevision(scope, projectId, revisionId);
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== 'drawing_revision.not_found') throw e;
      throw new AppError(
        'takeoff.revision_not_found',
        'That drawing revision is not on this project.',
        [{ path: 'revisionId', message: 'Not a drawing revision on this project' }],
      );
    }
  }

  async function insert(scope: TenantScope, projectId: string, input: MeasurementCreate) {
    check(input.kind, input.geometry, input.quantity);
    const packageId = input.packageId ?? null;
    const scopeKey = input.scopeKey ?? null;
    await checkLink(scope, projectId, packageId, scopeKey);
    const id = uuidv7();
    const confirmed = confirmedOnCreate(input.source);
    await scope.tx.insert(takeoffMeasurements).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      revisionId: input.revisionId,
      label: input.label.trim(),
      kind: input.kind,
      geometry: input.geometry,
      quantity: input.quantity,
      unit: input.unit.trim(),
      source: input.source,
      confidence: input.confidence ?? null,
      packageId,
      scopeKey,
      confirmedBy: confirmed ? scope.ctx.userId : null,
      confirmedAt: confirmed ? now() : null,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    scope.events.add({
      type: 'estimating.takeoff.created.v1',
      projectId,
      entityType: 'takeoff_measurement',
      entityId: id,
      entityVersion: 1,
      data: { measurementId: id, revisionId: input.revisionId, source: input.source },
    });
    return id;
  }

  async function create(scope: TenantScope, projectId: string, input: MeasurementCreate) {
    await assertRevision(scope, projectId, input.revisionId);
    return load(scope, projectId, await insert(scope, projectId, input));
  }

  /** What Nova found on one sheet, saved together as unconfirmed `assisted` measurements: all or none. */
  async function createAssisted(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    items: Array<Omit<MeasurementCreate, 'revisionId' | 'source'>>,
  ) {
    await assertRevision(scope, projectId, revisionId);
    const ids: string[] = [];
    for (const item of items)
      ids.push(await insert(scope, projectId, { ...item, revisionId, source: 'assisted' }));
    const rows = await scope.tx
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.id, ids))
      .orderBy(takeoffMeasurements.id);
    return rows;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: MeasurementFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    const geometry = patch.geometry ?? row.geometry;
    const quantity = patch.quantity ?? row.quantity;
    check(row.kind, geometry, quantity);
    const packageId = patch.packageId !== undefined ? patch.packageId : row.packageId;
    const scopeKey = patch.scopeKey !== undefined ? patch.scopeKey : row.scopeKey;
    await checkLink(scope, projectId, packageId, packageId ? scopeKey : null);
    // Changing the shape or the number on something Nova drew means a person must look at it again.
    const reopened =
      row.source !== 'manual' && (patch.geometry !== undefined || patch.quantity !== undefined);
    const [updated] = await scope.tx
      .update(takeoffMeasurements)
      .set({
        ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit.trim() } : {}),
        ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
        geometry,
        quantity,
        packageId,
        scopeKey: packageId ? scopeKey : null,
        ...(reopened ? { confirmedBy: null, confirmedAt: null } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(takeoffMeasurements.id, id), eq(takeoffMeasurements.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function confirm(scope: TenantScope, projectId: string, id: string, expected: number) {
    const row = await load(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    if (row.confirmedAt) return row;
    const [updated] = await scope.tx
      .update(takeoffMeasurements)
      .set({
        confirmedBy: scope.ctx.userId,
        confirmedAt: now(),
        rejectedBy: null,
        rejectedAt: null,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(takeoffMeasurements.id, id), eq(takeoffMeasurements.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    scope.events.add({
      type: 'estimating.takeoff.confirmed.v1',
      projectId,
      entityType: 'takeoff_measurement',
      entityId: id,
      entityVersion: updated.version,
      data: { measurementId: id, revisionId: row.revisionId },
    });
    return updated;
  }

  /** A person turns down something Nova drew: it stays on the sheet struck through, and never counts. */
  async function reject(scope: TenantScope, projectId: string, id: string, expected: number) {
    const row = await load(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    if (row.source === 'manual')
      throw new AppError('takeoff.invalid', 'Only what Nova drew can be rejected.', [
        { path: 'id', message: 'A hand-drawn measurement is deleted, not rejected' },
      ]);
    if (row.rejectedAt) return row;
    const [updated] = await scope.tx
      .update(takeoffMeasurements)
      .set({
        rejectedBy: scope.ctx.userId,
        rejectedAt: now(),
        confirmedBy: null,
        confirmedAt: null,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(takeoffMeasurements.id, id), eq(takeoffMeasurements.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    scope.events.add({
      type: 'estimating.takeoff.rejected.v1',
      projectId,
      entityType: 'takeoff_measurement',
      entityId: id,
      entityVersion: updated.version,
      data: { measurementId: id, revisionId: row.revisionId },
    });
    return updated;
  }

  /**
   * "Accept everything Nova is at least this sure of", or an explicit set. Only Nova's pending marks are touched:
   * hand-drawn ones are confirmed already and a rejected mark stays rejected until a person confirms it on its own.
   */
  async function confirmMany(
    scope: TenantScope,
    projectId: string,
    input: { revisionId: string; ids?: string[]; minConfidence?: number },
  ) {
    const t = takeoffMeasurements;
    const conditions = [
      eq(t.projectId, projectId),
      eq(t.revisionId, input.revisionId),
      isNull(t.deletedAt),
      isNull(t.confirmedAt),
      isNull(t.rejectedAt),
      ne(t.source, 'manual'),
    ];
    if (input.ids) conditions.push(inArray(t.id, input.ids));
    if (input.minConfidence !== undefined) conditions.push(gte(t.confidence, input.minConfidence));
    const updated = await scope.tx
      .update(t)
      .set({
        confirmedBy: scope.ctx.userId,
        confirmedAt: now(),
        version: sql`${t.version} + 1`,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(...conditions))
      .returning();
    for (const row of updated)
      scope.events.add({
        type: 'estimating.takeoff.confirmed.v1',
        projectId,
        entityType: 'takeoff_measurement',
        entityId: row.id,
        entityVersion: row.version,
        data: { measurementId: row.id, revisionId: row.revisionId },
      });
    return updated;
  }

  async function remove(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    await scope.tx
      .update(takeoffMeasurements)
      .set({ deletedAt: now(), version: row.version + 1, updatedBy: scope.ctx.userId })
      .where(eq(takeoffMeasurements.id, id));
  }

  return { list, get: load, create, createAssisted, update, confirm, confirmMany, reject, remove };
}

export type TakeoffService = ReturnType<typeof createTakeoffService>;
