import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { projectLocationTree, type LocationTreeKind } from '../infra/tables';
import { uniqueViolation } from './errors';
import type { ProjectService } from './projects';

export type TreeNodeRow = typeof projectLocationTree.$inferSelect;

/** Depth of the deepest allowed node (site > building > wing > level > zone > room > area > detail). */
export const MAX_LOCATION_DEPTH = 8;
export const MAX_LOCATIONS_PER_PROJECT = 3000;
export const PATH_SEPARATOR = ' › ';

export interface TreeNodeView extends TreeNodeRow {
  /** "Building A › Level 2 › Unit 201". Archived ancestors still count so old records read right. */
  path: string;
  depth: number;
}

export interface CreateLocationInput {
  parentId?: string | null;
  kind?: LocationTreeKind;
  name: string;
  code?: string | null;
}

export interface UpdateLocationInput {
  parentId?: string | null;
  kind?: LocationTreeKind;
  name?: string;
  code?: string | null;
  sort?: number;
  archived?: boolean;
}

export interface LocationSuggestion {
  locationId: string;
  path: string;
  /** What matched, so the person sees why Nova offered it. */
  reason: string;
  score: number;
}

const bad = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Adds `path` and `depth` to every row. Pure, so it is easy to test. */
export function withPaths(rows: TreeNodeRow[]): TreeNodeView[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cache = new Map<string, { path: string; depth: number }>();
  const walk = (r: TreeNodeRow): { path: string; depth: number } => {
    const hit = cache.get(r.id);
    if (hit) return hit;
    cache.set(r.id, { path: r.name, depth: 1 }); // guards a cycle that should never exist
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    const up = parent ? walk(parent) : null;
    const out = up
      ? { path: `${up.path}${PATH_SEPARATOR}${r.name}`, depth: up.depth + 1 }
      : { path: r.name, depth: 1 };
    cache.set(r.id, out);
    return out;
  };
  return rows.map((r) => ({ ...r, ...walk(r) }));
}

const WORD = /[a-z0-9]+/g;
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'to', 'and', 'for', 'near', 'by']);
const tokens = (s: string) => (s.toLowerCase().match(WORD) ?? []).filter((t) => !STOP.has(t));

/**
 * Rule-based Nova suggestion (no model call): which locations does this free text mention? Every name, code and
 * "level 2"-style phrase on the path scores; deeper matches win ties. The person confirms; nothing is saved here.
 */
export function suggestLocations(
  views: TreeNodeView[],
  text: string,
  limit = 3,
): LocationSuggestion[] {
  const words = new Set(tokens(text));
  // Punctuation and filler words dropped, so "Unit 201, bathroom" still contains " unit 201 ".
  const lower = ` ${(text.toLowerCase().match(WORD) ?? []).join(' ')} `;
  if (!words.size) return [];
  const live = views.filter((v) => !v.archivedAt);
  const byId = new Map(views.map((v) => [v.id, v]));
  const out: LocationSuggestion[] = [];
  for (const v of live) {
    let score = 0;
    const hits: string[] = [];
    // Walk this node and its ancestors; a match on the node itself counts most.
    let node: TreeNodeView | undefined = v;
    let weight = 3;
    while (node) {
      const name = node.name.toLowerCase();
      const nameTokens = tokens(name);
      const phrase = ` ${(name.match(WORD) ?? []).join(' ')} `;
      const code = node.code?.toLowerCase();
      if (lower.includes(phrase)) {
        score += weight * 2;
        hits.push(node.name);
      } else if (code && words.has(code)) {
        score += weight * 2;
        hits.push(node.code!);
      } else if (nameTokens.length && nameTokens.every((t) => words.has(t))) {
        score += weight;
        hits.push(node.name);
      }
      node = node.parentId ? byId.get(node.parentId) : undefined;
      weight = 1;
    }
    // Only the matched node itself may lead; an ancestor-only match is a broader place, offered if nothing is deeper.
    if (score > 0)
      out.push({
        locationId: v.id,
        path: v.path,
        reason: `Mentions ${[...new Set(hits)].join(', ')}`,
        score: score * 10 + v.depth,
      });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

export function createLocationTreeService(deps: { projects: ProjectService }) {
  async function all(scope: TenantScope, projectId: string): Promise<TreeNodeRow[]> {
    return scope.tx
      .select()
      .from(projectLocationTree)
      .where(eq(projectLocationTree.projectId, projectId))
      .orderBy(
        asc(projectLocationTree.sort),
        asc(projectLocationTree.name),
        asc(projectLocationTree.id),
      );
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<TreeNodeView[]> {
    await deps.projects.get(scope, projectId);
    const views = withPaths(await all(scope, projectId));
    return opts.includeArchived ? views : views.filter((v) => !v.archivedAt);
  }

  async function get(scope: TenantScope, projectId: string, id: string): Promise<TreeNodeView> {
    const rows = await all(scope, projectId);
    const row = withPaths(rows).find((v) => v.id === id);
    if (!row) throw new AppError('location.not_found');
    return row;
  }

  /**
   * Used by defects, RFIs, inspections and the diary before they store a `location_id`. A location that exists but
   * is archived is refused for new records; `allowArchived` lets an edit keep the place it already has.
   */
  async function resolve(
    scope: TenantScope,
    projectId: string,
    ids: string[],
    opts: { allowArchived?: boolean } = {},
  ): Promise<Map<string, { id: string; path: string; archived: boolean }>> {
    const wanted = [...new Set(ids)];
    const out = new Map<string, { id: string; path: string; archived: boolean }>();
    if (!wanted.length) return out;
    // Paths need ancestors, so read the project's tree once (bounded by MAX_LOCATIONS_PER_PROJECT).
    const views = withPaths(await all(scope, projectId));
    const byId = new Map(views.map((v) => [v.id, v]));
    for (const id of wanted) {
      const v = byId.get(id);
      if (!v) continue;
      out.set(id, { id, path: v.path, archived: !!v.archivedAt });
    }
    if (wanted.some((id) => !out.has(id)))
      throw bad('locationId', 'That location is not on this project.');
    if (!opts.allowArchived)
      for (const v of out.values())
        if (v.archived) throw bad('locationId', 'That location has been archived.');
    return out;
  }

  /** Names for display only: unknown ids are skipped rather than failing a register. */
  async function paths(
    scope: TenantScope,
    projectId: string,
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const wanted = new Set(ids.filter((i): i is string => !!i));
    if (!wanted.size) return new Map();
    const views = withPaths(await all(scope, projectId));
    return new Map(views.filter((v) => wanted.has(v.id)).map((v) => [v.id, v.path]));
  }

  async function checkParent(
    scope: TenantScope,
    projectId: string,
    rows: TreeNodeRow[],
    parentId: string | null,
    movingId?: string,
  ) {
    if (!parentId) return;
    const views = withPaths(rows);
    const parent = views.find((v) => v.id === parentId);
    if (!parent)
      throw new AppError('location.not_found', 'The parent location is not on this project.');
    if (parent.archivedAt) throw bad('parentId', 'The parent location is archived.');
    if (movingId) {
      // Never move a place under itself or one of its own descendants.
      let node: TreeNodeRow | undefined = parent;
      const byId = new Map(rows.map((r) => [r.id, r]));
      while (node) {
        if (node.id === movingId)
          throw new AppError('location.invalid', 'A location cannot sit inside itself.');
        node = node.parentId ? byId.get(node.parentId) : undefined;
      }
    }
    const depthBelow = movingId ? subtreeHeight(rows, movingId) : 0;
    if (parent.depth + 1 + depthBelow > MAX_LOCATION_DEPTH)
      throw new AppError(
        'location.too_deep',
        `Locations nest at most ${MAX_LOCATION_DEPTH} levels.`,
      );
  }

  function subtreeHeight(rows: TreeNodeRow[], id: string): number {
    const kids = new Map<string, TreeNodeRow[]>();
    for (const r of rows)
      if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
    const h = (n: string): number => Math.max(0, ...(kids.get(n) ?? []).map((k) => 1 + h(k.id)));
    return h(id);
  }

  function checkFields(input: { name?: string; code?: string | null }) {
    if (input.name !== undefined && !clean(input.name))
      throw bad('name', 'A location needs a name.');
    if (input.name !== undefined && clean(input.name).length > 120)
      throw bad('name', 'At most 120 characters.');
    if (
      input.code !== null &&
      input.code !== undefined &&
      (!input.code.trim() || input.code.trim().length > 30)
    )
      throw bad('code', 'A code is 1 to 30 characters.');
  }

  async function create(scope: TenantScope, projectId: string, input: CreateLocationInput) {
    await deps.projects.get(scope, projectId);
    checkFields(input);
    const rows = await all(scope, projectId);
    if (rows.length >= MAX_LOCATIONS_PER_PROJECT)
      throw bad('name', `A project holds at most ${MAX_LOCATIONS_PER_PROJECT} locations.`);
    const parentId = input.parentId ?? null;
    await checkParent(scope, projectId, rows, parentId);
    const siblings = rows.filter((r) => r.parentId === parentId);
    const id = uuidv7();
    try {
      await scope.tx.insert(projectLocationTree).values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        parentId,
        kind: input.kind ?? 'area',
        name: clean(input.name),
        code: input.code?.trim() || null,
        sort: siblings.reduce((m, r) => Math.max(m, r.sort), 0) + 10,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
    } catch (e) {
      if (uniqueViolation(e) !== null)
        throw new AppError('location.name_taken', 'That name is already used at this level.');
      throw e;
    }
    await scope.recordChange({
      module: 'platform',
      entityType: 'project_location',
      entityId: id,
      op: 'upsert',
      version: 1,
    });
    return get(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: UpdateLocationInput,
  ) {
    await deps.projects.get(scope, projectId);
    checkFields(patch);
    const rows = await all(scope, projectId);
    const current = rows.find((r) => r.id === id);
    if (!current) throw new AppError('location.not_found');
    if (current.version !== expectedVersion) throw versionConflict();
    const set: Partial<typeof projectLocationTree.$inferInsert> = {};
    if (patch.name !== undefined) set.name = clean(patch.name);
    if (patch.code !== undefined) set.code = patch.code?.trim() || null;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.sort !== undefined) set.sort = patch.sort;
    if (patch.parentId !== undefined && patch.parentId !== current.parentId) {
      await checkParent(scope, projectId, rows, patch.parentId, id);
      set.parentId = patch.parentId;
    }
    if (patch.archived !== undefined) {
      if (patch.archived && !current.archivedAt) {
        const live = rows.filter((r) => r.parentId === id && !r.archivedAt);
        if (live.length)
          throw new AppError('location.has_active_children', 'Archive the places inside it first.');
        set.archivedAt = new Date();
      }
      if (!patch.archived && current.archivedAt) {
        const parent = current.parentId ? rows.find((r) => r.id === current.parentId) : null;
        if (parent?.archivedAt) throw bad('archived', 'Restore the parent location first.');
        set.archivedAt = null;
      }
    }
    if (!Object.keys(set).length) return get(scope, projectId, id);
    try {
      const updated = await scope.tx
        .update(projectLocationTree)
        .set({
          ...set,
          updatedAt: new Date(),
          updatedBy: scope.ctx.userId,
          version: current.version + 1,
        })
        .where(
          and(eq(projectLocationTree.id, id), eq(projectLocationTree.version, expectedVersion)),
        )
        .returning({ id: projectLocationTree.id });
      if (!updated.length) throw versionConflict();
    } catch (e) {
      if (uniqueViolation(e) !== null)
        throw new AppError('location.name_taken', 'That name is already used at this level.');
      throw e;
    }
    await scope.recordChange({
      module: 'platform',
      entityType: 'project_location',
      entityId: id,
      op: 'upsert',
      version: current.version + 1,
    });
    return get(scope, projectId, id);
  }

  async function suggest(scope: TenantScope, projectId: string, text: string, limit = 3) {
    const views = await list(scope, projectId);
    return suggestLocations(views, text, limit);
  }

  return { list, get, create, update, resolve, paths, suggest };
}

export type LocationTreeService = ReturnType<typeof createLocationTreeService>;
