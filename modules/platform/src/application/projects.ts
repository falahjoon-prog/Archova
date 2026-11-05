import { and, asc, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm';
import { STATE_TIME_ZONES, encodeId, uuidv7 } from '@archova/domain';
import type { CreateProjectRequest, UpdateProjectRequest } from '@archova/contracts';
import {
  AppError,
  decodeCursor,
  resolveTimeZone,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { companies, orgs, projectMembers, projects } from '../infra/tables';
import { uniqueViolation } from './errors';

type ProjectRow = typeof projects.$inferSelect;

const isOrgAdmin = (scope: TenantScope) =>
  scope.ctx.orgRole === 'owner' || scope.ctx.orgRole === 'admin';

export function createProjectService(access: AccessService) {
  /** Org owners/admins see every project; everyone else sees projects they're an active member of. */
  /** Names and status only, for the owner console's support view. */
  async function listForSupport(scope: TenantScope, only: string[] | null) {
    const rows = await scope.tx
      .select()
      .from(projects)
      .where(and(isNull(projects.deletedAt), only ? inArray(projects.id, only) : undefined))
      .orderBy(asc(projects.id))
      .limit(200);
    return rows.map((r) => ({
      id: encodeId('project', r.id),
      name: r.name,
      number: r.number,
      status: r.status,
    }));
  }

  async function list(scope: TenantScope, opts: { limit: number; cursor?: string }) {
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [isNull(projects.deletedAt)];
    if (after) conditions.push(gt(projects.id, after.id));
    let rows: ProjectRow[];
    if (isOrgAdmin(scope)) {
      rows = await scope.tx
        .select()
        .from(projects)
        .where(and(...conditions))
        .orderBy(asc(projects.id))
        .limit(opts.limit + 1);
    } else {
      rows = (
        await scope.tx
          .select({ project: projects })
          .from(projects)
          .innerJoin(
            projectMembers,
            and(
              eq(projectMembers.projectId, projects.id),
              eq(projectMembers.userId, scope.ctx.userId),
              eq(projectMembers.status, 'active'),
            ),
          )
          .where(and(...conditions))
          .orderBy(asc(projects.id))
          .limit(opts.limit + 1)
      ).map((r) => r.project);
    }
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function get(scope: TenantScope, projectId: string): Promise<ProjectRow> {
    const [row] = await scope.tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('project.not_found');
    return row;
  }

  /** An explicit zone wins; otherwise the state's zone (QLD has no daylight saving, NSW does), else the org's. */
  function projectTimeZone(
    scope: TenantScope,
    input: { timezone?: string; state?: CreateProjectRequest['state'] },
    orgTimeZone: string,
  ) {
    const tz = input.timezone ?? (input.state ? STATE_TIME_ZONES[input.state] : orgTimeZone);
    return resolveTimeZone(scope.tx, tz);
  }

  function geofenceWithoutSite(): AppError {
    return new AppError('validation_failed', 'A geofence needs a site location.', [
      { path: 'geofenceRadiusM', message: 'Set siteLocation first' },
    ]);
  }

  /** Creates the project and adds the creator as Project Admin under the org's own company. */
  async function create(scope: TenantScope, input: CreateProjectRequest): Promise<ProjectRow> {
    const [org] = await scope.tx
      .select({ timezone: orgs.timezone })
      .from(orgs)
      .where(eq(orgs.id, scope.ctx.orgId));
    const [own] = await scope.tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.isOwnCompany, true));
    const adminTemplate = await access.templateIdByKey(scope, 'project_admin');
    if (!own || !adminTemplate || !org)
      throw new Error('Org is missing its own company or seeded templates');
    if (input.geofenceRadiusM !== undefined && !input.siteLocation) throw geofenceWithoutSite();
    const id = uuidv7();
    const userId = scope.ctx.userId;
    let row: ProjectRow;
    try {
      [row] = (await scope.tx
        .insert(projects)
        .values({
          id,
          orgId: scope.ctx.orgId,
          name: input.name.trim(),
          number: input.number ?? null,
          status: input.status ?? 'active',
          state: input.state ?? null,
          timezone: await projectTimeZone(scope, input, org.timezone),
          address: input.address ?? null,
          siteLat: input.siteLocation?.lat ?? null,
          siteLng: input.siteLocation?.lng ?? null,
          geofenceRadiusM: input.geofenceRadiusM ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning()) as [ProjectRow];
    } catch (e) {
      if (uniqueViolation(e) === 'projects_number')
        throw new AppError('project.number_taken', 'Another project already uses that number.');
      throw e;
    }
    const memberId = uuidv7();
    await scope.tx.insert(projectMembers).values({
      id: memberId,
      orgId: scope.ctx.orgId,
      projectId: id,
      userId,
      companyId: own.id,
      permissionTemplateId: adminTemplate,
      isExternal: false,
      status: 'active',
      createdBy: userId,
      updatedBy: userId,
    });
    await scope.recordChange({
      module: 'platform',
      entityType: 'project',
      entityId: id,
      op: 'upsert',
      version: 1,
      projectId: id,
    });
    await scope.recordChange({
      module: 'platform',
      entityType: 'project_member',
      entityId: memberId,
      op: 'upsert',
      version: 1,
      projectId: id,
    });
    scope.events.add({
      type: 'platform.project.created.v1',
      projectId: id,
      entityType: 'project',
      entityId: id,
      entityVersion: 1,
      data: { projectId: id, name: row.name },
    });
    return row;
  }

  /** Optimistic concurrency: the update applies only when `version` still equals If-Match (api.md §3). */
  async function update(
    scope: TenantScope,
    projectId: string,
    expectedVersion: number,
    patch: UpdateProjectRequest,
  ) {
    const current = await get(scope, projectId);
    if (current.version !== expectedVersion) throw versionConflict();
    const values: Partial<typeof projects.$inferInsert> = {
      updatedBy: scope.ctx.userId,
      version: current.version + 1,
    };
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.number !== undefined) values.number = patch.number;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.state !== undefined) values.state = patch.state;
    if (patch.timezone !== undefined)
      values.timezone = await projectTimeZone(
        scope,
        { timezone: patch.timezone },
        current.timezone,
      );
    else if (patch.state !== undefined && patch.state !== current.state)
      // Moving the project to another state moves its clock unless a zone was given with it.
      values.timezone = STATE_TIME_ZONES[patch.state];
    if (patch.address !== undefined) values.address = patch.address;
    if (patch.siteLocation !== undefined) {
      values.siteLat = patch.siteLocation?.lat ?? null;
      values.siteLng = patch.siteLocation?.lng ?? null;
      if (patch.siteLocation === null) values.geofenceRadiusM = null;
    }
    if (patch.geofenceRadiusM !== undefined) {
      const hasSite =
        patch.siteLocation !== undefined ? patch.siteLocation !== null : current.siteLat !== null;
      if (patch.geofenceRadiusM !== null && !hasSite) throw geofenceWithoutSite();
      values.geofenceRadiusM = patch.geofenceRadiusM;
    }
    if (patch.startDate !== undefined) values.startDate = patch.startDate;
    if (patch.endDate !== undefined) values.endDate = patch.endDate;
    let rows: ProjectRow[];
    try {
      rows = await scope.tx
        .update(projects)
        .set(values)
        .where(and(eq(projects.id, projectId), eq(projects.version, expectedVersion)))
        .returning();
    } catch (e) {
      if (uniqueViolation(e) === 'projects_number')
        throw new AppError('project.number_taken', 'Another project already uses that number.');
      throw e;
    }
    const row = rows[0];
    if (!row) throw versionConflict();
    await scope.recordChange({
      module: 'platform',
      entityType: 'project',
      entityId: projectId,
      op: 'upsert',
      version: row.version,
      projectId,
    });
    scope.events.add({
      type: 'platform.project.updated.v1',
      projectId,
      entityType: 'project',
      entityId: projectId,
      entityVersion: row.version,
      data: { projectId, changed: Object.keys(patch) },
    });
    return row;
  }

  /** Which of these ids are live projects of the caller's org (RLS limits the query to it). */
  async function existingIds(scope: TenantScope, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await scope.tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(isNull(projects.deletedAt), inArray(projects.id, ids)));
    return new Set(rows.map((r) => r.id));
  }

  return { list, listForSupport, existingIds, get, create, update };
}

export type ProjectService = ReturnType<typeof createProjectService>;
