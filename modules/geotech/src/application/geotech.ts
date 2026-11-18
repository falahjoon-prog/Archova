import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  evaluateTest,
  geotechFlags,
  summariseEarthworks,
  type EarthworksKind,
  type InvestigationKind,
  type TestKind,
  type TestResult,
} from '../domain/geotech';
import { earthworksEntries, investigations, testResults } from '../infra/tables';

export type InvestigationRow = typeof investigations.$inferSelect;
export type TestRow = typeof testResults.$inferSelect;
export type EarthworksRow = typeof earthworksEntries.$inferSelect;
export interface TestView extends TestRow {
  result: TestResult;
}

export interface GeotechDeps {
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface InvestigationFields {
  kind?: InvestigationKind;
  title?: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  depthM?: number | null;
  groundwaterDepthM?: number | null;
  investigatedOn?: string | null;
  consultantCompanyId?: string | null;
  summary?: string | null;
  fileIds?: string[];
}

export interface TestInput {
  investigationId?: string | null;
  kind: TestKind;
  sampleRef?: string | null;
  zone?: string | null;
  depthFromM?: number | null;
  depthToM?: number | null;
  value: number;
  unit?: string | null;
  specMin?: number | null;
  specMax?: number | null;
  testedOn: string;
  lab?: string | null;
  notes?: string | null;
}

export interface EarthworksInput {
  zone: string;
  kind: EarthworksKind;
  volumeM3: number;
  material?: string | null;
  recordedOn: string;
  notes?: string | null;
}

const trimOrNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function createGeotechService(deps: GeotechDeps) {
  const now = deps.now ?? (() => new Date());
  const testView = (r: TestRow): TestView => ({
    ...r,
    result: evaluateTest(r.value, r.specMin, r.specMax),
  });

  async function checkFiles(scope: TenantScope, projectId: string, ids: string[]) {
    for (const id of ids) {
      const f = await deps.files.getFile(scope, id);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: 'fileIds', message: 'Not a ready file in this project' },
        ]);
    }
  }

  async function checkCompany(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Name a company on this project.', [
        { path: 'consultantCompanyId', message: 'Not a company on the project' },
      ]);
  }

  async function loadInvestigation(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(investigations)
      .where(
        and(
          eq(investigations.id, id),
          eq(investigations.projectId, projectId),
          isNull(investigations.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('geotech.investigation_not_found');
    return row;
  }

  async function changed(scope: TenantScope, r: InvestigationRow) {
    scope.events.add({
      type: 'geotech.investigation.changed.v1',
      projectId: r.projectId,
      entityType: 'geotechInvestigation',
      entityId: r.id,
      entityVersion: r.version,
      data: { investigationId: r.id, kind: r.kind },
    });
  }

  async function listInvestigations(
    scope: TenantScope,
    projectId: string,
    opts: { kind?: InvestigationKind; limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const where: SQL[] = [
      eq(investigations.projectId, projectId),
      isNull(investigations.deletedAt),
    ];
    if (opts.kind) where.push(eq(investigations.kind, opts.kind));
    if (after) where.push(lt(investigations.id, after.id));
    const rows = await scope.tx
      .select()
      .from(investigations)
      .where(and(...where))
      .orderBy(desc(investigations.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function createInvestigation(
    scope: TenantScope,
    projectId: string,
    input: InvestigationFields & { kind: InvestigationKind; title: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (input.consultantCompanyId) await checkCompany(scope, projectId, input.consultantCompanyId);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    const number = await nextNumber(scope, projectId, 'geotechInvestigation');
    const [row] = await scope.tx
      .insert(investigations)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        number,
        kind: input.kind,
        title: input.title.trim(),
        location: trimOrNull(input.location),
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        depthM: input.depthM ?? null,
        groundwaterDepthM: input.groundwaterDepthM ?? null,
        investigatedOn: input.investigatedOn ?? null,
        consultantCompanyId: input.consultantCompanyId ?? null,
        summary: trimOrNull(input.summary),
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await changed(scope, row!);
    return row!;
  }

  async function updateInvestigation(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    p: InvestigationFields,
  ) {
    const row = await loadInvestigation(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (p.consultantCompanyId) await checkCompany(scope, projectId, p.consultantCompanyId);
    if (p.fileIds?.length) await checkFiles(scope, projectId, p.fileIds);
    const [next] = await scope.tx
      .update(investigations)
      .set({
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        ...(p.title !== undefined ? { title: p.title.trim() } : {}),
        ...(p.location !== undefined ? { location: trimOrNull(p.location) } : {}),
        ...(p.latitude !== undefined ? { latitude: p.latitude } : {}),
        ...(p.longitude !== undefined ? { longitude: p.longitude } : {}),
        ...(p.depthM !== undefined ? { depthM: p.depthM } : {}),
        ...(p.groundwaterDepthM !== undefined ? { groundwaterDepthM: p.groundwaterDepthM } : {}),
        ...(p.investigatedOn !== undefined ? { investigatedOn: p.investigatedOn } : {}),
        ...(p.consultantCompanyId !== undefined
          ? { consultantCompanyId: p.consultantCompanyId }
          : {}),
        ...(p.summary !== undefined ? { summary: trimOrNull(p.summary) } : {}),
        ...(p.fileIds !== undefined ? { fileIds: [...new Set(p.fileIds)] } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(investigations.id, id), eq(investigations.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await changed(scope, next);
    return next;
  }

  async function getInvestigation(scope: TenantScope, projectId: string, id: string) {
    return loadInvestigation(scope, projectId, id);
  }

  // ---- test results ----

  async function listTests(
    scope: TenantScope,
    projectId: string,
    opts: {
      investigationId?: string;
      kind?: TestKind;
      result?: TestResult;
      limit: number;
      cursor?: string;
    },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const where: SQL[] = [eq(testResults.projectId, projectId), isNull(testResults.deletedAt)];
    if (opts.investigationId) where.push(eq(testResults.investigationId, opts.investigationId));
    if (opts.kind) where.push(eq(testResults.kind, opts.kind));
    if (after) where.push(lt(testResults.id, after.id));
    // The pass/fail word is derived, so it is filtered after the read; a project holds tens to hundreds of results.
    const rows = await scope.tx
      .select()
      .from(testResults)
      .where(and(...where))
      .orderBy(desc(testResults.id))
      .limit(opts.result ? 500 : opts.limit + 1);
    const views = rows.map(testView);
    const filtered = opts.result ? views.filter((v) => v.result === opts.result) : views;
    return toPage(filtered, opts.limit, (r) => ({ id: r.id }));
  }

  async function addTest(scope: TenantScope, projectId: string, input: TestInput) {
    await deps.platform.getProject(scope, projectId);
    if (input.investigationId) await loadInvestigation(scope, projectId, input.investigationId);
    if (
      input.specMin !== undefined &&
      input.specMin !== null &&
      input.specMax !== undefined &&
      input.specMax !== null &&
      input.specMin > input.specMax
    )
      throw new AppError('validation_failed', 'The minimum is above the maximum.', [
        { path: 'specMin', message: 'Must not exceed the maximum' },
      ]);
    if (
      input.depthFromM !== undefined &&
      input.depthFromM !== null &&
      input.depthToM !== undefined &&
      input.depthToM !== null &&
      input.depthFromM > input.depthToM
    )
      throw new AppError('validation_failed', 'The depth range runs backwards.', [
        { path: 'depthFromM', message: 'Must not exceed the end depth' },
      ]);
    const [row] = await scope.tx
      .insert(testResults)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        investigationId: input.investigationId ?? null,
        kind: input.kind,
        sampleRef: trimOrNull(input.sampleRef),
        zone: trimOrNull(input.zone),
        depthFromM: input.depthFromM ?? null,
        depthToM: input.depthToM ?? null,
        value: input.value,
        unit: trimOrNull(input.unit) ?? '',
        specMin: input.specMin ?? null,
        specMax: input.specMax ?? null,
        testedOn: input.testedOn,
        lab: trimOrNull(input.lab),
        notes: trimOrNull(input.notes),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return testView(row!);
  }

  async function deleteTest(scope: TenantScope, projectId: string, id: string) {
    const res = await scope.tx
      .update(testResults)
      .set({ deletedAt: now() })
      .where(
        and(
          eq(testResults.id, id),
          eq(testResults.projectId, projectId),
          isNull(testResults.deletedAt),
        ),
      )
      .returning({ id: testResults.id });
    if (!res.length) throw new AppError('geotech.test_not_found');
  }

  // ---- earthworks ----

  async function listEarthworks(
    scope: TenantScope,
    projectId: string,
    opts: { zone?: string; kind?: EarthworksKind; limit: number; cursor?: string },
  ) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const where: SQL[] = [
      eq(earthworksEntries.projectId, projectId),
      isNull(earthworksEntries.deletedAt),
    ];
    if (opts.zone) where.push(eq(earthworksEntries.zone, opts.zone));
    if (opts.kind) where.push(eq(earthworksEntries.kind, opts.kind));
    if (after) where.push(lt(earthworksEntries.id, after.id));
    const rows = await scope.tx
      .select()
      .from(earthworksEntries)
      .where(and(...where))
      .orderBy(desc(earthworksEntries.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function addEarthworks(scope: TenantScope, projectId: string, input: EarthworksInput) {
    if (!(input.volumeM3 > 0))
      throw new AppError('validation_failed', 'Enter a volume above zero.', [
        { path: 'volumeM3', message: 'Must be above zero' },
      ]);
    await deps.platform.getProject(scope, projectId);
    const [row] = await scope.tx
      .insert(earthworksEntries)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        zone: input.zone.trim(),
        kind: input.kind,
        volumeM3: input.volumeM3,
        material: trimOrNull(input.material),
        recordedOn: input.recordedOn,
        notes: trimOrNull(input.notes),
        createdBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function deleteEarthworks(scope: TenantScope, projectId: string, id: string) {
    const res = await scope.tx
      .update(earthworksEntries)
      .set({ deletedAt: now() })
      .where(
        and(
          eq(earthworksEntries.id, id),
          eq(earthworksEntries.projectId, projectId),
          isNull(earthworksEntries.deletedAt),
        ),
      )
      .returning({ id: earthworksEntries.id });
    if (!res.length) throw new AppError('geotech.earthworks_not_found');
  }

  async function earthworksSummary(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({
        zone: earthworksEntries.zone,
        kind: earthworksEntries.kind,
        volumeM3: earthworksEntries.volumeM3,
      })
      .from(earthworksEntries)
      .where(and(eq(earthworksEntries.projectId, projectId), isNull(earthworksEntries.deletedAt)));
    return summariseEarthworks(rows);
  }

  /** Rule-based attention flags for Nova (no model): failed tests, short-of-fill zones, missing reports. */
  async function flags(scope: TenantScope, projectId: string) {
    const tests = (
      await scope.tx
        .select()
        .from(testResults)
        .where(and(eq(testResults.projectId, projectId), isNull(testResults.deletedAt)))
        .orderBy(desc(testResults.id))
        .limit(500)
    ).map(testView);
    const invs = await scope.tx
      .select()
      .from(investigations)
      .where(and(eq(investigations.projectId, projectId), isNull(investigations.deletedAt)));
    const { zones } = await earthworksSummary(scope, projectId);
    return geotechFlags({
      failedTests: tests.filter((t) => t.result === 'fail'),
      investigationsWithoutReport: invs.filter((i) => i.fileIds.length === 0),
      zones,
    });
  }

  return {
    listInvestigations,
    createInvestigation,
    updateInvestigation,
    getInvestigation,
    listTests,
    addTest,
    deleteTest,
    listEarthworks,
    addEarthworks,
    deleteEarthworks,
    earthworksSummary,
    flags,
  };
}

export type GeotechService = ReturnType<typeof createGeotechService>;
