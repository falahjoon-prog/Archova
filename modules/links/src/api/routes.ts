import { decodeId, encodeId, type IdKind, type LinkEntityType } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { EntityRef, LinkRow, LinksService } from '../application/links';

const bad = (path: string): never => {
  throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
/** A record named in a request: a known type and that type's prefixed id. */
const entity = (r: { type: string; id: string }, path: string): EntityRef => {
  const uuid = decodeId(r.type as IdKind, r.id);
  return uuid ? { type: r.type as LinkEntityType, id: uuid } : bad(`${path}/id`);
};
const publicRef = (r: EntityRef) => ({ type: r.type, id: encodeId(r.type, r.id) });

export function toLinkDto(l: LinkRow) {
  return {
    id: encodeId('relatedLink', l.id),
    projectId: encodeId('project', l.projectId),
    from: publicRef({ type: l.fromType as LinkEntityType, id: l.fromId }),
    to: publicRef({ type: l.toType as LinkEntityType, id: l.toId }),
    reason: l.reason as never,
    note: l.note,
    origin: l.origin as 'user' | 'nova' | 'system',
    createdById: encodeId('user', l.createdBy),
    createdAt: l.createdAt.toISOString(),
  };
}

export function linksRoutes(database: Database, svc: LinksService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listRelatedItems: async (input) => {
      const ref = entity(input.query, 'query');
      const out = await read(input, (s) => svc.list(s, project(input.params), ref));
      return {
        status: 200,
        body: {
          hidden: out.hidden,
          data: out.items.map((i) => ({
            linkId: encodeId('relatedLink', i.link.id),
            side: i.side,
            reason: i.link.reason as never,
            note: i.link.note,
            origin: i.link.origin as 'user' | 'nova' | 'system',
            createdById: encodeId('user', i.link.createdBy),
            createdByName: out.names.get(i.link.createdBy) ?? '',
            createdAt: i.link.createdAt.toISOString(),
            item: {
              type: i.other.type,
              id: encodeId(i.other.type, i.other.id),
              ref: i.other.ref,
              title: i.other.title,
              status: i.other.status,
            },
          })),
        },
      };
    },
    createRelatedItem: async (input) => {
      const from = entity(input.body.from, 'from');
      const to = entity(input.body.to, 'to');
      const row = await tx(input, (s) =>
        svc.create(s, project(input.params), {
          from,
          to,
          reason: input.body.reason,
          note: input.body.note,
        }),
      );
      return { status: 201, body: toLinkDto(row) };
    },
    searchRelatedItemCandidates: async (input) => {
      const hits = await read(input, (s) =>
        svc.candidates(s, project(input.params), {
          type: input.query.type,
          q: input.query.q ?? '',
          limit: input.query.limit ?? 8,
        }),
      );
      return {
        status: 200,
        body: {
          data: hits.map((h) => ({
            type: input.query.type,
            id: encodeId(input.query.type, h.id),
            ref: h.ref,
            title: h.title,
            status: h.status,
          })),
        },
      };
    },
    deleteRelatedItem: async (input) => {
      const id = decodeId('relatedLink', input.params.linkId);
      if (!id) throw new AppError('link.not_found');
      await tx(input, (s) => svc.remove(s, project(input.params), id));
      return { status: 204 };
    },
  });
}
