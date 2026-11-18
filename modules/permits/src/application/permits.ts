import { and, asc, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
  permitFlags,
  permitStatus,
  permitTransition,
  type LapsedLicence,
  type Lifecycle,
  type PermitAction,
  type PermitKind,
  type PermitStatus,
} from '../domain/permit';
import { permitEvents, permits, requirements } from '../infra/tables';

export type PermitRow = typeof permits.$inferSelect;
export type PermitEventRow = typeof permitEvents.$inferSelect;
export interface PermitView extends PermitRow {
  status: PermitStatus;
  daysToExpiry: number | null;
}

export interface PermitsDeps {
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  /** Wallet licences that have lapsed or are about to; provided by `workforce`, built after this module. */
  licences?: { lapsed(scope: TenantScope, today: string): Promise<LapsedLicence[]> };
  now?: () => Date;
}

export interface PermitFields {
  kind?: PermitKind;
  title?: string;
  issuingAuthority?: string | null;
  referenceNumber?: string | null;
  holderCompanyId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  fileIds?: string[];
}

const trimOrNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function createPermitService(deps: PermitsDeps) {
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
    r: PermitRow,
    day: ReturnType<typeof localDateOf>,
    leads: Map<string, number>,
  ): PermitView => ({
    ...r,
    status: permitStatus(r, day, leads.get(r.kind) ?? DEFAULT_LEAD_DAYS),
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
        { path: 'holderCompanyId', message: 'Not a company on the project' },
      ]);
  }

  async function record(
    scope: TenantScope,
    row: PermitRow,
    e: { action: string; from: Lifecycle | null; note?: string | null },
  ) {
    await scope.tx.insert(permitEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      permitId: row.id,
      action: e.action,
      fromLifecycle: e.from,
      toLifecycle: row.lifecycle,
      expiresOn: row.expiresOn,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function changed(scope: TenantScope, r: PermitRow) {
    scope.events.add({
      type: 'permits.permit.changed.v1',
      projectId: r.projectId,
      entityType: 'permit',
      entityId: r.id,
      entityVersion: r.version,
      data: { permitId: r.id, kind: r.kind, lifecycle: r.lifecycle, expiresOn: r.expiresOn },
    });
  }

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(permits)
      .where(and(eq(permits.id, id), eq(permits.projectId, projectId), isNull(permits.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('permit.not_found');
    return row;
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(permitEvents)
      .where(eq(permitEvents.permitId, id))
      .orderBy(asc(permitEvents.at), asc(permitEvents.id));
    const leads = new Map((await leadDays(scope, projectId)).map((r) => [r.kind, r.leadDays]));
    return { permit: view(row, await today(scope, projectId), leads), events };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      kind?: PermitKind;
      status?: PermitStatus;
      limit: number;
      cursor?: string;
    },
  ) {
    const day = await today(scope, projectId);
    const reqs = await leadDays(scope, projectId);
    const leads = new Map(reqs.map((r) => [r.kind, r.leadDays]));
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(permits.projectId, projectId), isNull(permits.deletedAt)];
    if (opts.kind) conditions.push(eq(permits.kind, opts.kind));
    if (after) conditions.push(lt(permits.id, after.id));
    // The status is derived, so it is filtered after the read; registers are small (tens of rows a project).
    const rows = await scope.tx
      .select()
      .from(permits)
      .where(and(...conditions))
      .orderBy(desc(permits.id))
      .limit(opts.status ? 500 : opts.limit + 1);
    const views = rows.map((r) => view(r, day, leads));
    const filtered = opts.status ? views.filter((v) => v.status === opts.status) : views;
    const page = toPage(filtered, opts.limit, (r) => ({ id: r.id }));
    return { data: page.data, nextCursor: page.nextCursor };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: PermitFields & { kind: PermitKind; title: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (input.holderCompanyId) await checkCompany(scope, projectId, input.holderCompanyId);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    assertDates(input.issuedOn, input.expiresOn);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'permit');
    const [row] = await scope.tx
      .insert(permits)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        kind: input.kind,
        title: input.title.trim(),
        issuingAuthority: trimOrNull(input.issuingAuthority),
        referenceNumber: trimOrNull(input.referenceNumber),
        holderCompanyId: input.holderCompanyId ?? null,
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
    patch: PermitFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.holderCompanyId) await checkCompany(scope, projectId, patch.holderCompanyId);
    if (patch.fileIds?.length) await checkFiles(scope, projectId, patch.fileIds);
    assertDates(
      patch.issuedOn === undefined ? row.issuedOn : patch.issuedOn,
      patch.expiresOn === undefined ? row.expiresOn : patch.expiresOn,
    );
    const [next] = await scope.tx
      .update(permits)
      .set({
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.issuingAuthority !== undefined
          ? { issuingAuthority: trimOrNull(patch.issuingAuthority) }
          : {}),
        ...(patch.referenceNumber !== undefined
          ? { referenceNumber: trimOrNull(patch.referenceNumber) }
          : {}),
        ...(patch.holderCompanyId !== undefined ? { holderCompanyId: patch.holderCompanyId } : {}),
        ...(patch.issuedOn !== undefined ? { issuedOn: patch.issuedOn } : {}),
        ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn } : {}),
        ...(patch.notes !== undefined ? { notes: trimOrNull(patch.notes) } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(permits.id, id), eq(permits.version, expectedVersion)))
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
    input: { action: PermitAction; newExpiresOn?: string | null; note?: string | null },
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    const result = permitTransition(row.lifecycle, input.action, {
      newExpiresOn: input.newExpiresOn ?? null,
      currentExpiresOn: row.expiresOn,
    });
    if (!result.ok)
      throw new AppError('permit.invalid_transition', result.reason, undefined, {
        lifecycle: row.lifecycle,
      });
    const day = await today(scope, projectId);
    const [next] = await scope.tx
      .update(permits)
      .set({
        lifecycle: result.to,
        renewalStartedOn: result.to === 'renewal_in_progress' ? day : null,
        ...(input.action === 'markRenewed' ? { expiresOn: input.newExpiresOn! } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(permits.id, id), eq(permits.version, expectedVersion)))
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
    items: { kind: PermitKind; leadDays: number }[],
  ) {
    await deps.platform.getProject(scope, projectId);
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.kind))
        throw new AppError('validation_failed', 'Each permit type can be listed once.', [
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
          createdBy: scope.ctx.userId,
        })),
      );
    return getRequirements(scope, projectId);
  }

  /** Rule-based, no model. `windowDays` overrides the 30-day default for permits whose type has no requirement. */
  async function flags(scope: TenantScope, projectId: string, windowDays?: number) {
    const day = await today(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(permits)
      .where(and(eq(permits.projectId, projectId), isNull(permits.deletedAt)));
    const reqs = await getRequirements(scope, projectId);
    const lapsed = deps.licences ? await deps.licences.lapsed(scope, day) : [];
    return permitFlags({
      permits: rows,
      requirements: reqs,
      lapsed,
      today: day,
      ...(windowDays ? { windowDays } : {}),
    });
  }

  /**
   * For other modules (the site compliance gate): the open permits on a project and their status today. A project
   * with no permits returns an empty list, which is not the same as "all permits current".
   */
  async function statusSummary(scope: TenantScope, projectId: string) {
    const day = await today(scope, projectId);
    const leads = new Map((await leadDays(scope, projectId)).map((r) => [r.kind, r.leadDays]));
    const rows = await scope.tx
      .select()
      .from(permits)
      .where(
        and(
          eq(permits.projectId, projectId),
          isNull(permits.deletedAt),
          sql`${permits.lifecycle} <> 'closed'`,
        ),
      );
    return rows.map((r) => {
      const v = view(r, day, leads);
      return {
        id: v.id,
        number: v.number,
        kind: v.kind,
        title: v.title,
        status: v.status,
        expiresOn: v.expiresOn,
      };
    });
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
    statusSummary,
  };
}

export type PermitService = ReturnType<typeof createPermitService>;
