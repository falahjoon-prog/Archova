import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  LINK_ENTITY_TYPES,
  MAX_LINKS_PER_ENTITY,
  cleanLinkNote,
  isSymmetricReason,
  uuidv7,
  type LinkEntityType,
  type LinkOrigin,
  type LinkReason,
} from '@archova/domain';
import { AppError, type LinkSource, type LinkSummary, type TenantScope } from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { links } from '../infra/tables';

export type LinkRow = typeof links.$inferSelect;
export interface EntityRef {
  type: LinkEntityType;
  id: string;
}

export interface LinksDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  identity: Pick<IdentityApi, 'getUsers'>;
  /** One per record type the caller can link; see `LinkSource`. */
  sources: Record<LinkEntityType, LinkSource>;
}

/** One link seen from a record: the record at the other end, and which side the viewed record is on. */
export interface RelatedItem {
  link: LinkRow;
  /** Where the record being looked at sits in the link. */
  side: 'from' | 'to';
  other: EntityRef & LinkSummary;
}

/** The deepest a graph walk goes, and the most records it returns. */
export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_MAX_NODES = 60;

export function createLinksService(deps: LinksDeps) {
  const knownType = (t: string): t is LinkEntityType =>
    (LINK_ENTITY_TYPES as readonly string[]).includes(t);

  /** Headline details of the records the caller may open, per type; anything missing from the map is hidden or gone. */
  async function summarise(scope: TenantScope, projectId: string, refs: readonly EntityRef[]) {
    const byType = new Map<LinkEntityType, Set<string>>();
    for (const r of refs) {
      if (!knownType(r.type)) continue;
      const set = byType.get(r.type) ?? new Set<string>();
      set.add(r.id);
      byType.set(r.type, set);
    }
    const out = new Map<string, LinkSummary>();
    for (const [type, ids] of byType) {
      for (const s of await deps.sources[type].summaries(scope, projectId, [...ids]))
        out.set(`${type}:${s.id}`, s);
    }
    return out;
  }
  const key = (r: EntityRef) => `${r.type}:${r.id}`;

  async function requireVisible(scope: TenantScope, projectId: string, ref: EntityRef) {
    const found = await summarise(scope, projectId, [ref]);
    const s = found.get(key(ref));
    if (!s) throw new AppError('link.entity_not_found');
    return s;
  }

  const touching = (projectId: string, ref: EntityRef): SQL =>
    and(
      eq(links.projectId, projectId),
      or(
        and(eq(links.fromType, ref.type), eq(links.fromId, ref.id)),
        and(eq(links.toType, ref.type), eq(links.toId, ref.id)),
      ),
    )!;

  /**
   * Everything linked to a record, newest first, from either end. Records the caller cannot open are counted in
   * `hidden` but never described, so a link cannot be used to learn that a restricted record exists or what it says.
   */
  async function list(scope: TenantScope, projectId: string, ref: EntityRef) {
    await deps.platform.getProject(scope, projectId);
    await requireVisible(scope, projectId, ref);
    const rows = await scope.tx
      .select()
      .from(links)
      .where(touching(projectId, ref))
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(MAX_LINKS_PER_ENTITY);
    const sided = rows.map((link) => {
      const side = link.fromType === ref.type && link.fromId === ref.id ? 'from' : 'to';
      const other: EntityRef =
        side === 'from'
          ? { type: link.toType as LinkEntityType, id: link.toId }
          : { type: link.fromType as LinkEntityType, id: link.fromId };
      return { link, side: side as 'from' | 'to', other };
    });
    const found = await summarise(
      scope,
      projectId,
      sided.map((s) => s.other),
    );
    const items: RelatedItem[] = [];
    let hidden = 0;
    for (const s of sided) {
      const summary = found.get(key(s.other));
      if (!summary) hidden += 1;
      else items.push({ link: s.link, side: s.side, other: { ...s.other, ...summary } });
    }
    const users = await deps.identity.getUsers([...new Set(items.map((i) => i.link.createdBy))]);
    const names = new Map([...users].map(([id, u]) => [id, u.name || u.email]));
    return { items, hidden, names };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      from: EntityRef;
      to: EntityRef;
      reason: LinkReason;
      note?: string | null | undefined;
      origin?: LinkOrigin;
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (key(input.from) === key(input.to))
      throw new AppError('validation_failed', 'A record cannot be linked to itself.', [
        { path: 'to', message: 'Pick a different record' },
      ]);
    // Both ends must be records this person can open now.
    const found = await summarise(scope, projectId, [input.from, input.to]);
    if (!found.has(key(input.from))) throw new AppError('link.entity_not_found');
    if (!found.has(key(input.to))) throw new AppError('link.entity_not_found');

    // The same pair is never stored twice; the plain "related" link also counts in the other direction.
    const same = and(
      eq(links.projectId, projectId),
      eq(links.fromType, input.from.type),
      eq(links.fromId, input.from.id),
      eq(links.toType, input.to.type),
      eq(links.toId, input.to.id),
      eq(links.reason, input.reason),
    )!;
    const reverse = and(
      eq(links.projectId, projectId),
      eq(links.fromType, input.to.type),
      eq(links.fromId, input.to.id),
      eq(links.toType, input.from.type),
      eq(links.toId, input.from.id),
      eq(links.reason, input.reason),
    )!;
    const [existing] = await scope.tx
      .select()
      .from(links)
      .where(isSymmetricReason(input.reason) ? or(same, reverse) : same)
      .limit(1);
    if (existing) return existing;

    for (const end of [input.from, input.to]) {
      const [{ n } = { n: 0 }] = await scope.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(links)
        .where(touching(projectId, end));
      if (n >= MAX_LINKS_PER_ENTITY)
        throw new AppError(
          'link.limit_reached',
          `A record can carry at most ${MAX_LINKS_PER_ENTITY} links.`,
        );
    }

    const row: LinkRow = {
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      fromType: input.from.type,
      fromId: input.from.id,
      toType: input.to.type,
      toId: input.to.id,
      reason: input.reason,
      note: cleanLinkNote(input.note),
      origin: input.origin ?? 'user',
      createdBy: scope.ctx.userId,
      createdAt: new Date(),
    };
    await scope.tx.insert(links).values(row);
    scope.events.add({
      type: 'links.link.created.v1',
      projectId,
      entityType: 'related_link',
      entityId: row.id,
      entityVersion: 1,
      data: { from: input.from, to: input.to, reason: input.reason },
    });
    return row;
  }

  /** Removing a link needs the same sight of it as making one, unless you made it yourself. */
  async function remove(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(links)
      .where(and(eq(links.id, id), eq(links.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('link.not_found');
    if (row.createdBy !== scope.ctx.userId) {
      const refs: EntityRef[] = [
        { type: row.fromType as LinkEntityType, id: row.fromId },
        { type: row.toType as LinkEntityType, id: row.toId },
      ];
      const found = await summarise(scope, projectId, refs);
      if (!refs.every((r) => found.has(key(r)))) throw new AppError('link.not_found');
    }
    await scope.tx.delete(links).where(eq(links.id, id));
    scope.events.add({
      type: 'links.link.removed.v1',
      projectId,
      entityType: 'related_link',
      entityId: id,
      entityVersion: 2,
      data: {
        from: { type: row.fromType, id: row.fromId },
        to: { type: row.toType, id: row.toId },
      },
    });
  }

  /** "Add link" pick-list: records of one type the caller can open that match some words. */
  async function candidates(
    scope: TenantScope,
    projectId: string,
    input: { type: LinkEntityType; q: string; limit: number },
  ) {
    await deps.platform.getProject(scope, projectId);
    const q = input.q.replace(/\s+/g, ' ').trim().slice(0, 100);
    const { hits } = await deps.sources[input.type].searchHits(scope, projectId, q, input.limit);
    return hits;
  }

  /**
   * Walks the links outward from a record, breadth first, to `depth` steps (at most `GRAPH_MAX_DEPTH`) and
   * `GRAPH_MAX_NODES` records. Only records the caller can open appear; a hidden record ends that branch and is
   * counted. Used by Ask Nova to explain a number from the RFIs, delays and defects behind it.
   */
  async function graph(scope: TenantScope, projectId: string, start: EntityRef, depth: number) {
    const maxDepth = Math.max(1, Math.min(depth, GRAPH_MAX_DEPTH));
    const root = await requireVisible(scope, projectId, start);
    const nodes = new Map<string, EntityRef & LinkSummary & { depth: number }>();
    nodes.set(key(start), { ...start, ...root, depth: 0 });
    const edges = new Map<string, LinkRow>();
    let hidden = 0;
    let truncated = false;
    let frontier: EntityRef[] = [start];
    for (let d = 1; d <= maxDepth && frontier.length > 0 && !truncated; d++) {
      const touched = or(...frontier.map((f) => touching(projectId, f)))!;
      const rows = await scope.tx.select().from(links).where(touched).limit(500);
      const candidatesFound = new Map<string, EntityRef>();
      for (const link of rows) {
        for (const end of [
          { type: link.fromType as LinkEntityType, id: link.fromId },
          { type: link.toType as LinkEntityType, id: link.toId },
        ])
          if (!nodes.has(key(end))) candidatesFound.set(key(end), end);
      }
      const found = await summarise(scope, projectId, [...candidatesFound.values()]);
      const next: EntityRef[] = [];
      for (const [k, ref] of candidatesFound) {
        const s = found.get(k);
        if (!s) {
          hidden += 1;
          continue;
        }
        if (nodes.size >= GRAPH_MAX_NODES) {
          truncated = true;
          break;
        }
        nodes.set(k, { ...ref, ...s, depth: d });
        next.push(ref);
      }
      for (const link of rows) {
        const a = key({ type: link.fromType as LinkEntityType, id: link.fromId });
        const b = key({ type: link.toType as LinkEntityType, id: link.toId });
        if (nodes.has(a) && nodes.has(b)) edges.set(link.id, link);
      }
      frontier = next;
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], hidden, truncated };
  }

  return { list, create, remove, candidates, graph, knownType };
}

export type LinksService = ReturnType<typeof createLinksService>;
