import { and, asc, eq, ne } from 'drizzle-orm';
import { LOCATION_KINDS, isGeoPoint, uuidv7, type LocationKind } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { projectLocations } from '../infra/tables';
import type { ProjectService } from './projects';

export type LocationRow = typeof projectLocations.$inferSelect;

export const MAX_LOCATIONS = 30;
const MAX_USED_FOR = 8;

export interface LocationInput {
  name: string;
  kind: LocationKind;
  address?: string | null;
  point?: { lat: number; lng: number } | null;
  accessNote?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  usedFor?: string[];
  isDefault?: boolean;
}

const bad = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export function createLocationService(deps: { projects: ProjectService }) {
  async function list(scope: TenantScope, projectId: string): Promise<LocationRow[]> {
    await deps.projects.get(scope, projectId);
    return scope.tx
      .select()
      .from(projectLocations)
      .where(eq(projectLocations.projectId, projectId))
      .orderBy(asc(projectLocations.sortOrder), asc(projectLocations.id));
  }

  async function find(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(projectLocations)
      .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.id, id)))
      .limit(1);
    if (!row) throw new AppError('project_location.not_found');
    return row;
  }

  function fields(input: LocationInput, base?: LocationRow) {
    const name = input.name.trim();
    if (!name) throw bad('name', 'A location needs a name.');
    if (!LOCATION_KINDS.includes(input.kind)) throw bad('kind', 'Unknown kind of location.');
    const address = input.address !== undefined ? clean(input.address) : (base?.address ?? null);
    const point =
      input.point !== undefined
        ? input.point
        : base?.lat !== null && base?.lat !== undefined && base.lng !== null
          ? { lat: base.lat, lng: base.lng }
          : null;
    if (point && !isGeoPoint(point)) throw bad('point', 'Not a valid map point.');
    if (!address && !point) throw bad('address', 'Give an address or a map point.');
    const usedFor = [
      ...new Set(
        (input.usedFor ?? base?.usedFor ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    if (usedFor.length > MAX_USED_FOR) throw bad('usedFor', `At most ${MAX_USED_FOR} tags.`);
    return {
      name,
      kind: input.kind,
      address,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      accessNote:
        input.accessNote !== undefined ? clean(input.accessNote) : (base?.accessNote ?? null),
      contactName:
        input.contactName !== undefined ? clean(input.contactName) : (base?.contactName ?? null),
      contactPhone:
        input.contactPhone !== undefined ? clean(input.contactPhone) : (base?.contactPhone ?? null),
      usedFor,
    };
  }

  /** Only one default per project: making this one the default clears the others. */
  async function clearOtherDefaults(scope: TenantScope, projectId: string, keep: string) {
    await scope.tx
      .update(projectLocations)
      .set({ isDefault: false })
      .where(
        and(
          eq(projectLocations.projectId, projectId),
          eq(projectLocations.isDefault, true),
          ne(projectLocations.id, keep),
        ),
      );
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: LocationInput,
  ): Promise<LocationRow> {
    const existing = await list(scope, projectId);
    if (existing.length >= MAX_LOCATIONS)
      throw bad('name', `A project can have at most ${MAX_LOCATIONS} locations.`);
    const f = fields(input);
    const id = uuidv7();
    // The first location is the default until the project says otherwise.
    const isDefault = input.isDefault ?? existing.length === 0;
    if (isDefault) await clearOtherDefaults(scope, projectId, id);
    const userId = scope.ctx.userId;
    const [row] = await scope.tx
      .insert(projectLocations)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        ...f,
        isDefault,
        sortOrder: existing.length ? Math.max(...existing.map((l) => l.sortOrder)) + 1 : 0,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    if (!row) throw new AppError('internal');
    scope.events.add({
      type: 'platform.project.location_changed.v1',
      projectId,
      entityType: 'project_location',
      entityId: id,
      entityVersion: row.version,
      data: { projectId, locationId: id, change: 'added' },
    });
    return row;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<LocationInput>,
  ): Promise<LocationRow> {
    await deps.projects.get(scope, projectId);
    const current = await find(scope, projectId, id);
    if (current.version !== expectedVersion) throw versionConflict();
    const f = fields({ name: current.name, kind: current.kind, ...patch }, current);
    const isDefault = patch.isDefault ?? current.isDefault;
    if (isDefault && !current.isDefault) await clearOtherDefaults(scope, projectId, id);
    const [row] = await scope.tx
      .update(projectLocations)
      .set({
        ...f,
        isDefault,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
        version: current.version + 1,
      })
      .where(and(eq(projectLocations.id, id), eq(projectLocations.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'platform.project.location_changed.v1',
      projectId,
      entityType: 'project_location',
      entityId: id,
      entityVersion: row.version,
      data: { projectId, locationId: id, change: 'updated' },
    });
    return row;
  }

  async function remove(scope: TenantScope, projectId: string, id: string): Promise<void> {
    await deps.projects.get(scope, projectId);
    const current = await find(scope, projectId, id);
    await scope.tx.delete(projectLocations).where(eq(projectLocations.id, id));
    // Losing the default hands it to the next point, so Nova always has one to fall back on.
    if (current.isDefault) {
      const [next] = await scope.tx
        .select()
        .from(projectLocations)
        .where(eq(projectLocations.projectId, projectId))
        .orderBy(asc(projectLocations.sortOrder), asc(projectLocations.id))
        .limit(1);
      if (next)
        await scope.tx
          .update(projectLocations)
          .set({ isDefault: true })
          .where(eq(projectLocations.id, next.id));
    }
    scope.events.add({
      type: 'platform.project.location_changed.v1',
      projectId,
      entityType: 'project_location',
      entityId: id,
      entityVersion: current.version,
      data: { projectId, locationId: id, change: 'removed' },
    });
  }

  return { list, create, update, remove };
}

export type LocationService = ReturnType<typeof createLocationService>;
