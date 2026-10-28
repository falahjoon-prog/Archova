import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { geofenceStatus, uuidv7, type GeoFix } from '@archova/domain';
import { localDateOf, type LocalDate } from '@archova/time';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import {
  autoCloseAt,
  dayTotals,
  decide,
  hashGateToken,
  minutesBetween,
  newGateToken,
  occurredAt as clampOccurredAt,
  workerReasons,
  type EligibilityReason,
  type GateCheckMode,
} from '../domain/attendance';
import {
  attendanceEvents,
  attendanceSessions,
  eligibilityChecks,
  gates,
  rollCallMarks,
  rollCalls,
  sites,
  workers,
  type AttendanceMethod,
  type MarkStatus,
  type RollCallEntry,
} from '../infra/tables';

export type SiteRow = typeof sites.$inferSelect;
export type GateRow = typeof gates.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
export type SessionRow = typeof attendanceSessions.$inferSelect;
export type CheckRow = typeof eligibilityChecks.$inferSelect;
export type RollCallRow = typeof rollCalls.$inferSelect;
export type MarkRow = typeof rollCallMarks.$inferSelect;

/**
 * The X54 `compliance` interface: "may this person work on this site today?". Phase 1 answers from
 * workforce's own records; each source adds reasons. Inductions and white cards register a source here
 * when they land; phase 2 swaps in Grace's wallet without changing callers.
 */
export type ComplianceSource = (
  scope: TenantScope,
  q: { worker: WorkerRow; projectId: string; siteId: string; localDate: LocalDate },
) => Promise<{ reasons: EligibilityReason[]; sources: unknown[] }>;

export interface WorkforceDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership' | 'companyExists'>;
  identity: Pick<IdentityApi, 'getUser'>;
  complianceSources?: ComplianceSource[];
  now?: () => Date;
}

export interface Viewer {
  scopedCompanyId: string | null;
  canManage: boolean;
  canOverride: boolean;
  canSeePersonal: boolean;
}

export interface SignInResult {
  outcome: 'accepted' | 'blocked' | 'overridden' | 'already_on_site';
  check: CheckRow | null;
  session: SessionRow | null;
  worker: WorkerRow;
}

export interface OnSiteEntry {
  session: SessionRow;
  worker: WorkerRow;
}

const NO_COMPANY = '00000000-0000-0000-0000-000000000000';

export function createAttendanceService(deps: WorkforceDeps) {
  const now = deps.now ?? (() => new Date());
  const sources = deps.complianceSources ?? [];

  async function viewer(scope: TenantScope, projectId: string): Promise<Viewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    const orgAdmin = perms.orgRole === 'owner' || perms.orgRole === 'admin';
    const scoped = !orgAdmin && perms.companyScopedTools.includes('workforce');
    const can = (key: string) => deps.access.can(scope, key, { projectId });
    const [canManage, canOverride, canSeePersonal] = await Promise.all([
      can('workforce.attendance.manage'),
      can('workforce.attendance.override'),
      can('workforce.workers.view_personal'),
    ]);
    return {
      scopedCompanyId: scoped ? (perms.companyId ?? NO_COMPANY) : null,
      canManage,
      canOverride,
      canSeePersonal,
    };
  }

  // -------------------------------------------------------------------------------------- sites & gates

  async function listSites(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(sites)
      .where(eq(sites.projectId, projectId))
      .orderBy(asc(sites.createdAt), asc(sites.id));
    const gateRows = await scope.tx
      .select()
      .from(gates)
      .where(eq(gates.projectId, projectId))
      .orderBy(asc(gates.createdAt), asc(gates.id));
    return rows.map((s) => ({ site: s, gates: gateRows.filter((g) => g.siteId === s.id) }));
  }

  async function getSite(scope: TenantScope, projectId: string, siteId: string) {
    const [row] = await scope.tx
      .select()
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('workforce_site.not_found');
    return row;
  }

  interface SiteFields {
    name?: string;
    boundary?: { lat: number; lng: number; radiusM: number } | null;
    dayEndLocal?: string;
    gateCheckMode?: GateCheckMode;
    active?: boolean;
  }

  function siteValues(f: SiteFields): Partial<typeof sites.$inferInsert> {
    const v: Partial<typeof sites.$inferInsert> = {};
    if (f.name !== undefined) v.name = f.name.trim();
    if (f.boundary !== undefined) {
      v.boundaryMode = f.boundary ? 'custom' : 'project';
      v.lat = f.boundary?.lat ?? null;
      v.lng = f.boundary?.lng ?? null;
      v.radiusM = f.boundary?.radiusM ?? null;
    }
    if (f.dayEndLocal !== undefined) v.dayEndLocal = f.dayEndLocal;
    if (f.gateCheckMode !== undefined) v.gateCheckMode = f.gateCheckMode;
    if (f.active !== undefined) v.active = f.active;
    return v;
  }

  async function createSite(
    scope: TenantScope,
    projectId: string,
    input: SiteFields & { name: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    try {
      const [row] = await scope.tx
        .insert(sites)
        .values({
          ...siteValues(input),
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          name: input.name.trim(),
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    } catch (e) {
      throw nameTaken(e, 'workforce_site.name_taken');
    }
  }

  async function updateSite(
    scope: TenantScope,
    projectId: string,
    siteId: string,
    expectedVersion: number,
    patch: SiteFields,
  ) {
    const site = await getSite(scope, projectId, siteId);
    if (site.version !== expectedVersion) throw versionConflict();
    try {
      const [row] = await scope.tx
        .update(sites)
        .set({
          ...siteValues(patch),
          version: site.version + 1,
          updatedAt: now(),
          updatedBy: scope.ctx.userId,
        })
        .where(and(eq(sites.id, siteId), eq(sites.version, expectedVersion)))
        .returning();
      if (!row) throw versionConflict();
      return row;
    } catch (e) {
      throw nameTaken(e, 'workforce_site.name_taken');
    }
  }

  async function getGate(scope: TenantScope, projectId: string, gateId: string) {
    const [row] = await scope.tx
      .select()
      .from(gates)
      .where(and(eq(gates.id, gateId), eq(gates.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('gate.not_found');
    return row;
  }

  async function createGate(scope: TenantScope, projectId: string, siteId: string, name: string) {
    await getSite(scope, projectId, siteId);
    const { token, hash } = newGateToken();
    try {
      const [row] = await scope.tx
        .insert(gates)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          siteId,
          name: name.trim(),
          qrTokenHash: hash,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return { gate: row!, qrToken: token };
    } catch (e) {
      throw nameTaken(e, 'gate.name_taken');
    }
  }

  /** "Revoke and reissue" (ATT-AC1): a new token; posters with the old one stop working at once. */
  async function reissueGate(
    scope: TenantScope,
    projectId: string,
    gateId: string,
    expectedVersion: number,
  ) {
    const gate = await getGate(scope, projectId, gateId);
    if (gate.version !== expectedVersion) throw versionConflict();
    const { token, hash } = newGateToken();
    const [row] = await scope.tx
      .update(gates)
      .set({
        qrTokenHash: hash,
        qrVersion: gate.qrVersion + 1,
        version: gate.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(gates.id, gateId), eq(gates.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'workforce.gate.reissued.v1',
      projectId,
      entityType: 'gate',
      entityId: gateId,
      entityVersion: row.version,
      data: { gateId, qrVersion: row.qrVersion },
    });
    return { gate: row, qrToken: token };
  }

  async function updateGate(
    scope: TenantScope,
    projectId: string,
    gateId: string,
    expectedVersion: number,
    patch: { name?: string; active?: boolean },
  ) {
    const gate = await getGate(scope, projectId, gateId);
    if (gate.version !== expectedVersion) throw versionConflict();
    try {
      const [row] = await scope.tx
        .update(gates)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          version: gate.version + 1,
          updatedAt: now(),
          updatedBy: scope.ctx.userId,
        })
        .where(and(eq(gates.id, gateId), eq(gates.version, expectedVersion)))
        .returning();
      if (!row) throw versionConflict();
      return row;
    } catch (e) {
      throw nameTaken(e, 'gate.name_taken');
    }
  }

  async function gateByToken(scope: TenantScope, projectId: string, token: string) {
    const [gate] = await scope.tx
      .select()
      .from(gates)
      .where(and(eq(gates.qrTokenHash, hashGateToken(token)), eq(gates.projectId, projectId)))
      .limit(1);
    if (!gate || !gate.active)
      throw new AppError(
        'gate.invalid_code',
        'This sign-in code is no longer valid. Use the poster at the gate.',
      );
    return gate;
  }

  // -------------------------------------------------------------------------------------------- workers

  interface WorkerFields {
    fullName?: string;
    companyId?: string | null;
    companyNameOther?: string | null;
    phone?: string | null;
    email?: string | null;
    kind?: 'worker' | 'visitor' | 'delivery';
    status?: 'active' | 'inactive';
  }

  async function getWorker(scope: TenantScope, workerId: string, v?: Viewer) {
    const [row] = await scope.tx.select().from(workers).where(eq(workers.id, workerId)).limit(1);
    if (!row || (v?.scopedCompanyId && row.companyId !== v.scopedCompanyId))
      throw new AppError('worker.not_found');
    return row;
  }

  async function checkCompany(scope: TenantScope, v: Viewer, companyId: string | null | undefined) {
    if (companyId === undefined || companyId === null) return;
    if (v.scopedCompanyId && companyId !== v.scopedCompanyId)
      throw new AppError('access.denied', 'You can only manage workers in your own company.');
    if (!(await deps.platform.companyExists(scope, companyId)))
      throw new AppError('company.not_found', 'Pick a company from the directory.', [
        { path: 'companyId', message: 'Unknown company' },
      ]);
  }

  async function listWorkers(
    scope: TenantScope,
    projectId: string,
    opts: { companyId?: string; kind?: string; q?: string },
  ) {
    const v = await viewer(scope, projectId);
    const where: SQL[] = [];
    if (v.scopedCompanyId) where.push(eq(workers.companyId, v.scopedCompanyId));
    else if (opts.companyId) where.push(eq(workers.companyId, opts.companyId));
    if (opts.kind) where.push(eq(workers.kind, opts.kind as WorkerRow['kind']));
    if (opts.q)
      where.push(
        or(ilike(workers.fullName, `%${opts.q}%`), ilike(workers.companyNameOther, `%${opts.q}%`))!,
      );
    const rows = await scope.tx
      .select()
      .from(workers)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(workers.fullName), asc(workers.id))
      .limit(500);
    return { rows, viewer: v };
  }

  async function createWorker(
    scope: TenantScope,
    projectId: string,
    input: WorkerFields & { fullName: string },
  ) {
    const v = await viewer(scope, projectId);
    const companyId =
      input.companyId ?? (v.scopedCompanyId && !input.companyNameOther ? v.scopedCompanyId : null);
    await checkCompany(scope, v, companyId);
    if (v.scopedCompanyId && !companyId)
      throw new AppError('access.denied', 'You can only add workers to your own company.');
    if ((input.kind ?? 'worker') === 'worker' && !companyId && !input.companyNameOther)
      throw new AppError('validation_failed', 'Pick the worker’s company, or type its name.', [
        { path: 'companyId', message: 'Required' },
      ]);
    const [row] = await scope.tx
      .insert(workers)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        fullName: input.fullName.trim(),
        companyId,
        companyNameOther: companyId ? null : (input.companyNameOther?.trim() ?? null),
        phone: input.phone ?? null,
        email: input.email ?? null,
        kind: input.kind ?? 'worker',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await workerChanged(scope, row!);
    return { row: row!, viewer: v };
  }

  async function updateWorker(
    scope: TenantScope,
    projectId: string,
    workerId: string,
    expectedVersion: number,
    patch: WorkerFields,
  ) {
    const v = await viewer(scope, projectId);
    const w = await getWorker(scope, workerId, v);
    if (w.version !== expectedVersion) throw versionConflict();
    await checkCompany(scope, v, patch.companyId);
    const values: Partial<typeof workers.$inferInsert> = {};
    if (patch.fullName !== undefined) values.fullName = patch.fullName.trim();
    // Picking a directory company confirms an "other" company typed at the gate (ATT-AC2).
    if (patch.companyId !== undefined) {
      values.companyId = patch.companyId;
      if (patch.companyId) values.companyNameOther = null;
    }
    if (patch.companyNameOther !== undefined && !patch.companyId)
      values.companyNameOther = patch.companyNameOther;
    if (patch.phone !== undefined) values.phone = patch.phone;
    if (patch.email !== undefined) values.email = patch.email;
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.status !== undefined) values.status = patch.status;
    const [row] = await scope.tx
      .update(workers)
      .set({ ...values, version: w.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(workers.id, workerId), eq(workers.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await workerChanged(scope, row);
    return { row, viewer: v };
  }

  /** The caller's own worker record in this org, created from their account the first time they sign in. */
  async function selfWorker(scope: TenantScope, projectId: string) {
    const [existing] = await scope.tx
      .select()
      .from(workers)
      .where(eq(workers.userId, scope.ctx.userId))
      .limit(1);
    const membership = await deps.platform.getProjectMembership(scope, projectId, scope.ctx.userId);
    if (existing) {
      if (!existing.companyId && membership) {
        const [row] = await scope.tx
          .update(workers)
          .set({
            companyId: membership.companyId,
            companyNameOther: null,
            version: existing.version + 1,
            updatedAt: now(),
          })
          .where(eq(workers.id, existing.id))
          .returning();
        return row!;
      }
      return existing;
    }
    const user = await deps.identity.getUser(scope.ctx.userId);
    const [row] = await scope.tx
      .insert(workers)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        userId: scope.ctx.userId,
        fullName: user?.name || user?.email || 'Unknown',
        email: user?.email ?? null,
        companyId: membership?.companyId ?? null,
        companyNameOther: membership ? null : 'Unknown',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await workerChanged(scope, row!);
    return row!;
  }

  // ------------------------------------------------------------------------------------------ sign in/out

  async function openSession(scope: TenantScope, projectId: string, workerId: string) {
    const [row] = await scope.tx
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          eq(attendanceSessions.workerId, workerId),
          isNull(attendanceSessions.signedOutAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function checkEligibility(
    scope: TenantScope,
    projectId: string,
    site: SiteRow,
    worker: WorkerRow,
    localDate: LocalDate,
  ) {
    const reasons = workerReasons(worker);
    const found: unknown[] = [{ type: 'worker', id: worker.id, version: worker.version }];
    for (const source of sources) {
      const r = await source(scope, { worker, projectId, siteId: site.id, localDate });
      reasons.push(...r.reasons);
      found.push(...r.sources);
    }
    const [row] = await scope.tx
      .insert(eligibilityChecks)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        siteId: site.id,
        workerId: worker.id,
        localDate,
        checkedAt: now(),
        result: decide(reasons, site.gateCheckMode),
        reasons,
        sources: found,
      })
      .returning();
    return row!;
  }

  function fenceFor(
    site: SiteRow,
    project: { siteLat: number | null; siteLng: number | null; geofenceRadiusM: number | null },
  ) {
    if (
      site.boundaryMode === 'custom' &&
      site.lat !== null &&
      site.lng !== null &&
      site.radiusM !== null
    )
      return { centre: { lat: site.lat, lng: site.lng }, radiusM: site.radiusM };
    if (project.siteLat !== null && project.siteLng !== null && project.geofenceRadiusM !== null)
      return {
        centre: { lat: project.siteLat, lng: project.siteLng },
        radiusM: project.geofenceRadiusM,
      };
    return null;
  }

  async function signIn(
    scope: TenantScope,
    projectId: string,
    input: {
      site: SiteRow;
      gateId: string | null;
      worker: WorkerRow;
      method: AttendanceMethod;
      clientAt?: Date;
      location?: GeoFix | null;
      offline?: boolean;
      overrideReason?: string;
      canOverride: boolean;
    },
  ): Promise<SignInResult> {
    const { site, worker } = input;
    if (!site.active)
      throw new AppError('workforce_site.inactive', 'Sign-in is closed at this site.');
    const project = await deps.platform.getProject(scope, projectId);
    const receivedAt = now();
    const at = clampOccurredAt(input.clientAt, receivedAt);
    const localDate = localDateOf(at, project.timezone);
    const open = await openSession(scope, projectId, worker.id);
    if (open) return { outcome: 'already_on_site', check: null, session: open, worker };

    const check = await checkEligibility(scope, projectId, site, worker, localDate);
    let outcome: 'accepted' | 'blocked' | 'overridden' = 'accepted';
    const override = input.overrideReason?.trim();
    if (check.result === 'blocked') {
      if (override && input.canOverride) outcome = 'overridden';
      else if (override)
        throw new AppError('access.denied', 'Only a site manager can let a blocked worker in.');
      else outcome = 'blocked';
    }
    const fence = input.location ? fenceFor(site, project) : null;
    const base = {
      orgId: scope.ctx.orgId,
      projectId,
      siteId: site.id,
      gateId: input.gateId,
      workerId: worker.id,
      method: input.method,
      occurredAt: at,
      receivedAt,
      localDate,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      accuracyM: input.location?.accuracyM ?? null,
      fixSource: input.location
        ? input.location.source === 'manual'
          ? ('manual' as const)
          : ('device' as const)
        : null,
      geofenceStatus: input.location && fence ? geofenceStatus(input.location, fence) : null,
      recordedBy: scope.ctx.userId,
      eligibilityCheckId: check.id,
      offline: input.offline ?? false,
    };

    if (outcome === 'blocked') {
      await scope.tx
        .insert(attendanceEvents)
        .values({ ...base, id: uuidv7(), kind: 'sign_in', outcome: 'blocked' });
      // The site manager is told so they can induct the worker on the spot (ATT-AC7).
      scope.events.add({
        type: 'workforce.attendance.blocked.v1',
        projectId,
        entityType: 'worker',
        entityId: worker.id,
        data: { workerId: worker.id, siteId: site.id, reasons: check.reasons.map((r) => r.code) },
      });
      return { outcome, check, session: null, worker };
    }

    const sessionId = uuidv7();
    const [session] = await scope.tx
      .insert(attendanceSessions)
      .values({
        id: sessionId,
        orgId: scope.ctx.orgId,
        projectId,
        siteId: site.id,
        workerId: worker.id,
        companyId: worker.companyId,
        localDate,
        signedInAt: at,
      })
      .returning();
    await scope.tx.insert(attendanceEvents).values({
      ...base,
      id: uuidv7(),
      sessionId,
      kind: 'sign_in',
      outcome,
      ...(outcome === 'overridden'
        ? { overrideReason: override!, overrideBy: scope.ctx.userId }
        : {}),
    });
    await sessionChanged(scope, session!);
    scope.events.add({
      type: 'workforce.attendance.signed_in.v1',
      projectId,
      entityType: 'attendance_session',
      entityId: sessionId,
      entityVersion: 1,
      data: {
        sessionId,
        workerId: worker.id,
        companyId: worker.companyId,
        siteId: site.id,
        localDate,
        kind: worker.kind,
        outcome,
        ...(outcome === 'overridden' ? { overrideReason: override } : {}),
      },
    });
    return { outcome, check, session: session!, worker };
  }

  async function companyDay(
    scope: TenantScope,
    projectId: string,
    localDate: LocalDate,
    companyId: string,
  ) {
    const rows = await scope.tx
      .select({
        companyId: attendanceSessions.companyId,
        workerId: attendanceSessions.workerId,
        minutes: attendanceSessions.minutes,
      })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          eq(attendanceSessions.localDate, localDate),
          eq(attendanceSessions.companyId, companyId),
          sql`${attendanceSessions.signedOutAt} is not null`,
        ),
      );
    return dayTotals(rows)[0] ?? { companyId, headcount: 0, hours: 0 };
  }

  async function signOut(
    scope: TenantScope,
    projectId: string,
    input: {
      session: SessionRow;
      at: Date;
      method: AttendanceMethod;
      gateId?: string | null;
      auto?: boolean;
    },
  ) {
    const { session } = input;
    const at = input.at.getTime() < session.signedInAt.getTime() ? session.signedInAt : input.at;
    const minutes = minutesBetween(session.signedInAt, at);
    const [row] = await scope.tx
      .update(attendanceSessions)
      .set({
        signedOutAt: at,
        minutes,
        status: input.auto ? 'auto_closed' : 'off_site',
        version: session.version + 1,
        updatedAt: now(),
      })
      .where(and(eq(attendanceSessions.id, session.id), isNull(attendanceSessions.signedOutAt)))
      .returning();
    if (!row) throw new AppError('attendance.not_on_site', 'This worker is not signed in.');
    await scope.tx.insert(attendanceEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      siteId: session.siteId,
      gateId: input.gateId ?? null,
      workerId: session.workerId,
      sessionId: session.id,
      kind: input.auto ? 'auto_sign_out' : 'sign_out',
      method: input.method,
      occurredAt: at,
      receivedAt: now(),
      localDate: session.localDate,
      recordedBy: input.auto ? null : scope.ctx.userId,
    });
    await sessionChanged(scope, row);
    const totals = row.companyId
      ? await companyDay(scope, projectId, row.localDate, row.companyId)
      : null;
    // The diary rolls these into its labour lines (ATT-AC6); auto-closed hours are flagged as not exact.
    scope.events.add({
      type: 'workforce.attendance.session_closed.v1',
      projectId,
      entityType: 'attendance_session',
      entityId: row.id,
      entityVersion: row.version,
      data: {
        sessionId: row.id,
        workerId: row.workerId,
        companyId: row.companyId,
        siteId: row.siteId,
        localDate: row.localDate,
        minutes,
        autoClosed: Boolean(input.auto),
        dayTotals: totals,
      },
    });
    return row;
  }

  async function selfSignIn(
    scope: TenantScope,
    projectId: string,
    input: { gateToken: string; clientAt?: Date; location?: GeoFix | null; offline?: boolean },
  ) {
    const gate = await gateByToken(scope, projectId, input.gateToken);
    const site = await getSite(scope, projectId, gate.siteId);
    const worker = await selfWorker(scope, projectId);
    return signIn(scope, projectId, {
      site,
      gateId: gate.id,
      worker,
      method: 'qr',
      ...(input.clientAt ? { clientAt: input.clientAt } : {}),
      location: input.location ?? null,
      offline: input.offline ?? false,
      canOverride: false,
    });
  }

  async function selfSignOut(
    scope: TenantScope,
    projectId: string,
    input: { gateToken?: string; clientAt?: Date },
  ) {
    const gate = input.gateToken ? await gateByToken(scope, projectId, input.gateToken) : null;
    const worker = await selfWorker(scope, projectId);
    const session = await openSession(scope, projectId, worker.id);
    if (!session)
      throw new AppError('attendance.not_on_site', 'You are not signed in to this project.');
    return signOut(scope, projectId, {
      session,
      at: clampOccurredAt(input.clientAt, now()),
      method: gate ? 'qr' : 'manual',
      gateId: gate?.id ?? null,
    });
  }

  /** A site manager signs someone in or out from a tablet at the gate (ATT-US6), or admits a blocked worker. */
  async function record(
    scope: TenantScope,
    projectId: string,
    input: {
      workerId: string;
      siteId?: string;
      kind: 'sign_in' | 'sign_out';
      clientAt?: Date;
      overrideReason?: string;
    },
  ) {
    const v = await viewer(scope, projectId);
    const worker = await getWorker(scope, input.workerId);
    if (input.kind === 'sign_out') {
      const session = await openSession(scope, projectId, worker.id);
      if (!session) throw new AppError('attendance.not_on_site', 'This worker is not signed in.');
      const row = await signOut(scope, projectId, {
        session,
        at: clampOccurredAt(input.clientAt, now()),
        method: 'manual',
      });
      return { outcome: 'signed_out' as const, check: null, session: row, worker };
    }
    if (!input.siteId)
      throw new AppError('validation_failed', 'Pick the site.', [
        { path: 'siteId', message: 'Required to sign in' },
      ]);
    const site = await getSite(scope, projectId, input.siteId);
    return signIn(scope, projectId, {
      site,
      gateId: null,
      worker,
      method: 'manual',
      ...(input.clientAt ? { clientAt: input.clientAt } : {}),
      ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
      canOverride: v.canOverride,
    });
  }

  // ---------------------------------------------------------------------------------- headcount & records

  async function onSite(scope: TenantScope, projectId: string, siteId?: string) {
    const v = await viewer(scope, projectId);
    const where: SQL[] = [
      eq(attendanceSessions.projectId, projectId),
      isNull(attendanceSessions.signedOutAt),
    ];
    if (siteId) where.push(eq(attendanceSessions.siteId, siteId));
    if (v.scopedCompanyId) where.push(eq(attendanceSessions.companyId, v.scopedCompanyId));
    const rows = await scope.tx
      .select({ session: attendanceSessions, worker: workers })
      .from(attendanceSessions)
      .innerJoin(workers, eq(workers.id, attendanceSessions.workerId))
      .where(and(...where))
      .orderBy(asc(attendanceSessions.companyId), asc(workers.fullName));
    return { entries: rows as OnSiteEntry[], viewer: v };
  }

  async function sessionsForDay(
    scope: TenantScope,
    projectId: string,
    opts: { date: LocalDate; siteId?: string; companyId?: string },
  ) {
    const v = await viewer(scope, projectId);
    const where: SQL[] = [
      eq(attendanceSessions.projectId, projectId),
      eq(attendanceSessions.localDate, opts.date),
    ];
    if (opts.siteId) where.push(eq(attendanceSessions.siteId, opts.siteId));
    if (v.scopedCompanyId) where.push(eq(attendanceSessions.companyId, v.scopedCompanyId));
    else if (opts.companyId) where.push(eq(attendanceSessions.companyId, opts.companyId));
    const rows = await scope.tx
      .select({ session: attendanceSessions, worker: workers })
      .from(attendanceSessions)
      .innerJoin(workers, eq(workers.id, attendanceSessions.workerId))
      .where(and(...where))
      .orderBy(asc(attendanceSessions.signedInAt), asc(attendanceSessions.id));
    return { entries: rows as OnSiteEntry[], viewer: v };
  }

  /**
   * Mobile pull (modules/sync): the sessions among `ids` the caller may see, by the same rule as
   * `sessionsForDay` (a company-scoped viewer sees only their own company's); the rest go out as deletes.
   */
  async function visibleSessions(scope: TenantScope, projectId: string, ids: readonly string[]) {
    if (!ids.length) return [];
    const v = await viewer(scope, projectId);
    const where: SQL[] = [
      eq(attendanceSessions.projectId, projectId),
      inArray(attendanceSessions.id, [...ids]),
    ];
    if (v.scopedCompanyId) where.push(eq(attendanceSessions.companyId, v.scopedCompanyId));
    return scope.tx
      .select()
      .from(attendanceSessions)
      .where(and(...where));
  }

  /**
   * Closes sessions still open after their site's day end (ATT-AC4). Run by the scheduled job per org;
   * sign-out time is the day end, and the hours are flagged as not exact.
   */
  async function closeOverdueSessions(scope: TenantScope) {
    const open = await scope.tx
      .select({ session: attendanceSessions, dayEnd: sites.dayEndLocal })
      .from(attendanceSessions)
      .innerJoin(sites, eq(sites.id, attendanceSessions.siteId))
      .where(isNull(attendanceSessions.signedOutAt));
    const zones = new Map<string, string>();
    let closed = 0;
    for (const { session, dayEnd } of open) {
      let tz = zones.get(session.projectId);
      if (!tz) {
        tz = (await deps.platform.getProject(scope, session.projectId)).timezone;
        zones.set(session.projectId, tz);
      }
      const at = autoCloseAt(session.localDate, dayEnd, tz);
      if (at.getTime() > now().getTime()) continue;
      await signOut(scope, session.projectId, { session, at, method: 'auto', auto: true });
      closed++;
    }
    return closed;
  }

  // ------------------------------------------------------------------------------------------ roll calls

  async function getRollCall(scope: TenantScope, projectId: string, rollCallId: string) {
    const [call] = await scope.tx
      .select()
      .from(rollCalls)
      .where(and(eq(rollCalls.id, rollCallId), eq(rollCalls.projectId, projectId)))
      .limit(1);
    if (!call) throw new AppError('roll_call.not_found');
    const marks = await scope.tx
      .select()
      .from(rollCallMarks)
      .where(eq(rollCallMarks.rollCallId, rollCallId))
      .orderBy(asc(rollCallMarks.markedAt), asc(rollCallMarks.id));
    return { call, marks };
  }

  /** Starts an evacuation roll call from who is on site now (ATT-AC5); the snapshot is the record. */
  async function startRollCall(
    scope: TenantScope,
    projectId: string,
    input: { siteId?: string; reason: string },
  ) {
    if (input.siteId) await getSite(scope, projectId, input.siteId);
    const { entries } = await onSite(scope, projectId, input.siteId);
    const snapshot: RollCallEntry[] = entries.map(({ session, worker }) => ({
      workerId: worker.id,
      fullName: worker.fullName,
      phone: worker.phone,
      companyId: worker.companyId,
      companyNameOther: worker.companyNameOther,
      siteId: session.siteId,
      signedInAt: session.signedInAt.toISOString(),
    }));
    const id = uuidv7();
    await scope.tx.insert(rollCalls).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      siteId: input.siteId ?? null,
      startedBy: scope.ctx.userId,
      startedAt: now(),
      reason: input.reason.trim(),
      snapshot,
    });
    scope.events.add({
      type: 'workforce.roll_call.started.v1',
      projectId,
      entityType: 'roll_call',
      entityId: id,
      data: { rollCallId: id, siteId: input.siteId ?? null, onSite: snapshot.length },
    });
    return getRollCall(scope, projectId, id);
  }

  async function markRollCall(
    scope: TenantScope,
    projectId: string,
    rollCallId: string,
    input: { workerId: string; status: MarkStatus },
  ) {
    const { call } = await getRollCall(scope, projectId, rollCallId);
    if (call.endedAt) throw new AppError('roll_call.ended', 'This roll call has ended.');
    if (!call.snapshot.some((e) => e.workerId === input.workerId))
      await getWorker(scope, input.workerId);
    await scope.tx.insert(rollCallMarks).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      rollCallId,
      workerId: input.workerId,
      status: input.status,
      markedBy: scope.ctx.userId,
      markedAt: now(),
    });
    return getRollCall(scope, projectId, rollCallId);
  }

  async function endRollCall(scope: TenantScope, projectId: string, rollCallId: string) {
    const { call } = await getRollCall(scope, projectId, rollCallId);
    if (call.endedAt) return getRollCall(scope, projectId, rollCallId);
    await scope.tx
      .update(rollCalls)
      .set({ endedAt: now(), endedBy: scope.ctx.userId })
      .where(eq(rollCalls.id, rollCallId));
    scope.events.add({
      type: 'workforce.roll_call.ended.v1',
      projectId,
      entityType: 'roll_call',
      entityId: rollCallId,
      data: { rollCallId },
    });
    return getRollCall(scope, projectId, rollCallId);
  }

  /** Newest first, each with its latest marks. `open` keeps only calls not yet ended (the evacuation in progress). */
  async function listRollCalls(
    scope: TenantScope,
    projectId: string,
    opts: { open?: boolean } = {},
  ) {
    const calls = await scope.tx
      .select()
      .from(rollCalls)
      .where(
        and(
          eq(rollCalls.projectId, projectId),
          opts.open === undefined
            ? undefined
            : opts.open
              ? isNull(rollCalls.endedAt)
              : sql`${rollCalls.endedAt} is not null`,
        ),
      )
      .orderBy(desc(rollCalls.startedAt))
      .limit(20);
    if (calls.length === 0) return [];
    const marks = await scope.tx
      .select()
      .from(rollCallMarks)
      .where(
        inArray(
          rollCallMarks.rollCallId,
          calls.map((c) => c.id),
        ),
      )
      .orderBy(asc(rollCallMarks.markedAt), asc(rollCallMarks.id));
    return calls.map((call) => ({ call, marks: marks.filter((m) => m.rollCallId === call.id) }));
  }

  return {
    viewer,
    getSite,
    getWorker,
    selfWorker,
    listSites,
    createSite,
    updateSite,
    createGate,
    reissueGate,
    updateGate,
    listWorkers,
    createWorker,
    updateWorker,
    selfSignIn,
    selfSignOut,
    record,
    onSite,
    sessionsForDay,
    closeOverdueSessions,
    startRollCall,
    getRollCall,
    markRollCall,
    endRollCall,
    listRollCalls,
    visibleSessions,
  };
}

function nameTaken(e: unknown, code: 'workforce_site.name_taken' | 'gate.name_taken') {
  const err = e as { code?: string; cause?: { code?: string } };
  if (err.code === '23505' || err.cause?.code === '23505')
    return new AppError(code, 'That name is already used here.', [
      { path: 'name', message: 'Already used' },
    ]);
  return e;
}

export async function workerChanged(scope: TenantScope, w: WorkerRow) {
  await scope.recordChange({
    module: 'workforce',
    entityType: 'worker',
    entityId: w.id,
    op: 'upsert',
    version: w.version,
    scopeCompanyId: w.companyId,
  });
}

async function sessionChanged(scope: TenantScope, s: SessionRow) {
  await scope.recordChange({
    module: 'workforce',
    entityType: 'attendance_session',
    entityId: s.id,
    op: 'upsert',
    version: s.version,
    projectId: s.projectId,
    scopeCompanyId: s.companyId,
  });
}

export type AttendanceService = ReturnType<typeof createAttendanceService>;
