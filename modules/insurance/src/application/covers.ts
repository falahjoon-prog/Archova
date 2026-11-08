import { and, asc, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
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
  DEFAULT_LEAD_DAYS,
  daysToExpiry,
  coverFlags,
  companyIssues,
  gateState,
  coverStatus,
  coverTransition,
  type Lifecycle,
  type CoverAction,
  type CoverKind,
  type CoverStatus,
} from '../domain/cover';
import { coverEvents, covers, requirements } from '../infra/tables';

export type CoverRow = typeof covers.$inferSelect;
export type CoverEventRow = typeof coverEvents.$inferSelect;
export interface CoverView extends CoverRow {
  status: CoverStatus;
  daysToExpiry: number | null;
}

export interface InsuranceDeps {
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface CoverFields {
  kind?: CoverKind;
  title?: string;
  issuer?: string | null;
  amountCents?: number | null;
  referenceNumber?: string | null;
  companyId?: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  fileIds?: string[];
}

const trimOrNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function createCoverService(deps: InsuranceDeps) {
  const now = deps.now ?? (() => new Date());

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  async function leadDays(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    return rows;
  }

  const view = (
    r: CoverRow,
    day: ReturnType<typeof localDateOf>,
    leads: Map<string, number>,
  ): CoverView => ({
    ...r,
    status: coverStatus(r, day, leads.get(r.kind) ?? DEFAULT_LEAD_DAYS),
    daysToExpiry: daysToExpiry(r.expiresOn, day),
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
        { path: 'companyId', message: 'Not a company on the project' },
      ]);
  }

  async function record(
    scope: TenantScope,
    row: CoverRow,
    e: { action: string; from: Lifecycle | null; note?: string | null },
  ) {
    await scope.tx.insert(coverEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      coverId: row.id,
      action: e.action,
      fromLifecycle: e.from,
      toLifecycle: row.lifecycle,
      expiresOn: row.expiresOn,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function changed(scope: TenantScope, r: CoverRow) {
    scope.events.add({
      type: 'insurance.cover.changed.v1',
      projectId: r.projectId,
      entityType: 'cover',
      entityId: r.id,
      entityVersion: r.version,
      data: { coverId: r.id, kind: r.kind, lifecycle: r.lifecycle, expiresOn: r.expiresOn },
    });
  }

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(covers)
      .where(and(eq(covers.id, id), eq(covers.projectId, projectId), isNull(covers.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('cover.not_found');
    return row;
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(coverEvents)
      .where(eq(coverEvents.coverId, id))
      .orderBy(asc(coverEvents.at), asc(coverEvents.id));
    const leads = new Map((await leadDays(scope, projectId)).map((r) => [r.kind, r.leadDays]));
    return { cover: view(row, await today(scope, projectId), leads), events };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      kind?: CoverKind;
      companyId?: string;
      status?: CoverStatus;
      limit: number;
      cursor?: string;
    },
  ) {
    const day = await today(scope, projectId);
    const reqs = await leadDays(scope, projectId);
    const leads = new Map(reqs.map((r) => [r.kind, r.leadDays]));
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(covers.projectId, projectId), isNull(covers.deletedAt)];
    if (opts.kind) conditions.push(eq(covers.kind, opts.kind));
    if (opts.companyId) conditions.push(eq(covers.companyId, opts.companyId));
    if (after) conditions.push(lt(covers.id, after.id));
    // The status is derived, so it is filtered after the read; registers are small (tens of rows a project).
    const rows = await scope.tx
      .select()
      .from(covers)
      .where(and(...conditions))
      .orderBy(desc(covers.id))
      .limit(opts.status ? 500 : opts.limit + 1);
    const views = rows.map((r) => view(r, day, leads));
    const filtered = opts.status ? views.filter((v) => v.status === opts.status) : views;
    const page = toPage(filtered, opts.limit, (r) => ({ id: r.id }));
    return { data: page.data, nextCursor: page.nextCursor };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: CoverFields & { kind: CoverKind; title: string; companyId: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    await checkCompany(scope, projectId, input.companyId);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    assertDates(input.issuedOn, input.expiresOn);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'cover');
    const [row] = await scope.tx
      .insert(covers)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        kind: input.kind,
        title: input.title.trim(),
        issuer: trimOrNull(input.issuer),
        amountCents: input.amountCents ?? null,
        referenceNumber: trimOrNull(input.referenceNumber),
        companyId: input.companyId,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        notes: trimOrNull(input.notes),
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await record(scope, row!, { action: 'add', from: null });
    await changed(scope, row!);
    return detail(scope, projectId, id);
  }

  function assertDates(issuedOn?: string | null, expiresOn?: string | null) {
    if (issuedOn && expiresOn && issuedOn > expiresOn)
      throw new AppError('validation_failed', 'The expiry date is before the issue date.', [
        { path: 'expiresOn', message: 'Must be on or after the issue date' },
      ]);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: CoverFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.companyId) await checkCompany(scope, projectId, patch.companyId);
    if (patch.fileIds?.length) await checkFiles(scope, projectId, patch.fileIds);
    assertDates(
      patch.issuedOn === undefined ? row.issuedOn : patch.issuedOn,
      patch.expiresOn === undefined ? row.expiresOn : patch.expiresOn,
    );
    const [next] = await scope.tx
      .update(covers)
      .set({
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.issuer !== undefined ? { issuer: trimOrNull(patch.issuer) } : {}),
        ...(patch.amountCents !== undefined ? { amountCents: patch.amountCents } : {}),
        ...(patch.referenceNumber !== undefined
          ? { referenceNumber: trimOrNull(patch.referenceNumber) }
          : {}),
        ...(patch.companyId !== undefined ? { companyId: patch.companyId } : {}),
        ...(patch.issuedOn !== undefined ? { issuedOn: patch.issuedOn } : {}),
        ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn } : {}),
        ...(patch.notes !== undefined ? { notes: trimOrNull(patch.notes) } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(covers.id, id), eq(covers.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, { action: 'edit', from: row.lifecycle });
    await changed(scope, next);
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: CoverAction; newExpiresOn?: string | null; note?: string | null },
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    const result = coverTransition(row.lifecycle, input.action, {
      newExpiresOn: input.newExpiresOn ?? null,
      currentExpiresOn: row.expiresOn,
    });
    if (!result.ok)
      throw new AppError('cover.invalid_transition', result.reason, undefined, {
        lifecycle: row.lifecycle,
      });
    const day = await today(scope, projectId);
    const [next] = await scope.tx
      .update(covers)
      .set({
        lifecycle: result.to,
        renewalStartedOn: result.to === 'renewal_in_progress' ? day : null,
        ...(input.action === 'markRenewed' ? { expiresOn: input.newExpiresOn! } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(covers.id, id), eq(covers.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, {
      action: input.action,
      from: row.lifecycle,
      note: trimOrNull(input.note),
    });
    await changed(scope, next);
    return detail(scope, projectId, id);
  }

  // ---- requirements and flags ----

  async function getRequirements(scope: TenantScope, projectId: string) {
    return (await leadDays(scope, projectId)).sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** Replaces the project's expected set. An empty list switches the "missing" flags off. */
  async function setRequirements(
    scope: TenantScope,
    projectId: string,
    items: { kind: CoverKind; leadDays: number; minAmountCents?: number | null }[],
  ) {
    await deps.platform.getProject(scope, projectId);
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.kind))
        throw new AppError('validation_failed', 'Each cover type can be listed once.', [
          { path: 'items', message: `Duplicate ${i.kind}` },
        ]);
      seen.add(i.kind);
    }
    await scope.tx.delete(requirements).where(eq(requirements.projectId, projectId));
    if (items.length)
      await scope.tx.insert(requirements).values(
        items.map((i) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          kind: i.kind,
          leadDays: i.leadDays,
          minAmountCents: i.minAmountCents ?? null,
          createdBy: scope.ctx.userId,
        })),
      );
    return getRequirements(scope, projectId);
  }

  async function companyNames(scope: TenantScope, projectId: string) {
    const list = await deps.platform.projectCompanies(scope, projectId);
    return new Map(list.map((c) => [c.id, c.name]));
  }

  /** Rule-based, no model. `windowDays` overrides the 30-day default for covers whose type has no requirement. */
  async function flags(scope: TenantScope, projectId: string, windowDays?: number) {
    const day = await today(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(covers)
      .where(and(eq(covers.projectId, projectId), isNull(covers.deletedAt)));
    const names = await companyNames(scope, projectId);
    return coverFlags({
      covers: rows.map((r) => ({ ...r, companyName: names.get(r.companyId) ?? 'A company' })),
      requirements: await getRequirements(scope, projectId),
      today: day,
      ...(windowDays ? { windowDays } : {}),
    });
  }

  /**
   * For the site compliance gate and Nova: where one company stands today. Applies the project's requirements to the
   * company whether or not it has anything on the register yet, so a company with nothing recorded is "blocked" only
   * when the project has set requirements. A project that has set none never blocks anyone, and says so.
   */
  async function companyClearance(scope: TenantScope, projectId: string, companyId: string) {
    const day = await today(scope, projectId);
    const reqs = await getRequirements(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(covers)
      .where(
        and(
          eq(covers.projectId, projectId),
          eq(covers.companyId, companyId),
          isNull(covers.deletedAt),
        ),
      );
    const issues = companyIssues({ covers: rows, requirements: reqs, today: day });
    return {
      state: gateState(issues),
      requirementsSet: reqs.length > 0,
      coverCount: rows.filter((r) => r.lifecycle !== 'closed').length,
      issues,
    };
  }

  return {
    list,
    create,
    detail,
    update,
    transition,
    getRequirements,
    setRequirements,
    flags,
    companyClearance,
  };
}

export type CoverService = ReturnType<typeof createCoverService>;
