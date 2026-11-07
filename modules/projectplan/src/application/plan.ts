import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type {
  CreatePlanItemRequest,
  PlanItemType as ApiItemType,
  PlanLinkInput,
  PlanPartyInput,
  ProjectPlan,
  UpdatePlanItemRequest,
} from '@archova/contracts';
import { addDays, localDateOf } from '@archova/time';
import { AppError, type SearchHit, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import { createNotifications } from '@archova/mod-notifications';
import type { PlatformApi } from '@archova/mod-platform';
import {
  SUGGEST_THRESHOLD,
  TYPE_TO_LINK,
  blockingHolds,
  draftPhaseSummary,
  insightsFor,
  isHold,
  isOverdue,
  itemNumber,
  planOrder,
  titleMatch,
  type FlatItem,
  type InsightItem,
  type ItemType,
  type LinkType,
  type Party,
} from '../domain/plan';
import { STANDARD_PLAN } from '../domain/template';
import { items, phases, requests, type StoredLink, type StoredReference } from '../infra/tables';

type Source = {
  searchHits(
    scope: TenantScope,
    projectId: string,
    q: string,
    limit: number,
  ): Promise<{ restricted: boolean; hits: readonly SearchHit[] }>;
};

export interface ProjectPlanDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  /** One `searchHits` per kind of record an item can link to. A kind with none can still be linked by id. */
  records: Partial<Record<LinkType, Source>>;
  now?: () => Date;
}

type PhaseRow = typeof phases.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type RequestRow = typeof requests.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const LINK_KIND: Record<LinkType, IdKind | null> = {
  rfi: 'rfi',
  submittal: 'submittal',
  inspection: 'inspection',
  meeting: 'meeting',
  drawing: 'drawingSheet',
  document: 'document',
  correspondence: 'correspondence',
  defect: 'defect',
  esign_envelope: null,
};

/** How many records of one kind are read to show current status and to rank link options. */
const RECORD_WINDOW = 200;

export function createProjectPlanService(deps: ProjectPlanDeps) {
  const now = deps.now ?? (() => new Date());

  const decodeUser = (v: string, path: string) => {
    const id = decodeId('user', v);
    if (!id) throw invalid(path, 'Invalid id');
    return id;
  };

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  async function allPhases(scope: TenantScope, projectId: string) {
    return scope.tx
      .select()
      .from(phases)
      .where(and(eq(phases.projectId, projectId), isNull(phases.deletedAt)))
      .orderBy(asc(phases.position), asc(phases.id));
  }
  async function allItems(scope: TenantScope, projectId: string) {
    return scope.tx
      .select()
      .from(items)
      .where(and(eq(items.projectId, projectId), isNull(items.deletedAt)))
      .orderBy(asc(items.position), asc(items.id));
  }

  /** Current status of every linked record, one read per kind of record, best effort. */
  async function linkStatuses(scope: TenantScope, projectId: string, rows: readonly ItemRow[]) {
    const kinds = new Set<LinkType>();
    for (const r of rows) for (const l of r.links) kinds.add(l.type);
    const out = new Map<string, SearchHit>();
    for (const type of kinds) {
      const src = deps.records[type];
      if (!src) continue;
      const { hits } = await src.searchHits(scope, projectId, '', RECORD_WINDOW);
      for (const h of hits) out.set(`${type}:${encodeLinkId(type, h.id)}`, h);
    }
    return out;
  }
  const encodeLinkId = (type: LinkType, uuid: string) => {
    const kind = LINK_KIND[type];
    return kind ? encodeId(kind, uuid) : uuid;
  };

  async function canClear(scope: TenantScope, projectId: string) {
    return deps.access.can(scope, 'projectplan.holds.clear', { projectId });
  }

  async function view(scope: TenantScope, projectId: string): Promise<ProjectPlan> {
    const [phaseRows, itemRows, canManage, clearer, todayStr] = await Promise.all([
      allPhases(scope, projectId),
      allItems(scope, projectId),
      deps.access.can(scope, 'projectplan.plan.write', { projectId }),
      canClear(scope, projectId),
      today(scope, projectId),
    ]);
    const itemIds = itemRows.map((i) => i.id);
    const reqRows: RequestRow[] = itemIds.length
      ? await scope.tx
          .select()
          .from(requests)
          .where(and(inArray(requests.itemId, itemIds), sql`${requests.status} <> 'cancelled'`))
          .orderBy(asc(requests.createdAt))
      : [];
    const statuses = await linkStatuses(scope, projectId, itemRows);
    const phaseNo = new Map(phaseRows.map((p) => [p.id, p.position]));
    const flat: (FlatItem & { number: string; title: string })[] = itemRows
      .filter((i) => phaseNo.has(i.phaseId))
      .map((i) => ({
        id: i.id,
        phaseId: i.phaseId,
        phasePosition: phaseNo.get(i.phaseId)!,
        position: i.position,
        status: i.status,
        types: i.itemTypes,
        holdCleared: i.holdClearedAt !== null,
        number: itemNumber(phaseNo.get(i.phaseId)!, i.position),
        title: i.title,
      }));
    const flatById = new Map(flat.map((f) => [f.id, f]));
    const itemEnc = (id: string) => encodeId('planItem', id);

    const toItem = (i: ItemRow) => {
      const f = flatById.get(i.id)!;
      const hold = isHold(i.itemTypes);
      const blockers = i.status === 'complete' ? [] : blockingHolds(flat, f);
      return {
        id: itemEnc(i.id),
        phaseId: encodeId('planPhase', i.phaseId),
        number: f.number,
        position: i.position,
        title: i.title,
        outcome: i.outcome,
        types: i.itemTypes as ApiItemType[],
        dueDate: i.dueDate,
        status: i.status,
        isOverdue: isOverdue(i.status, i.dueDate, todayStr),
        blockedBy: blockers.map((b) => ({
          itemId: itemEnc(b.id),
          number: b.number,
          title: b.title,
        })),
        parties: i.parties.map((p) => ({
          kind: p.kind,
          companyId: p.companyId ? encodeId('company', p.companyId) : null,
          userIds: p.userIds.map((u) => encodeId('user', u)),
          label: p.label,
          confirmed: p.confirmed,
        })),
        references: i.referenceDocs.map((r) => ({
          label: r.label,
          url: r.url,
          fileId: r.fileId ? encodeId('file', r.fileId) : null,
        })),
        links: i.links.map((l) => {
          const hit = statuses.get(`${l.type}:${l.id}`);
          return {
            type: l.type,
            id: l.id,
            ref: hit?.ref ?? l.ref,
            label: hit?.title ?? l.label,
            status: hit?.status ?? null,
          };
        }),
        requests: reqRows
          .filter((r) => r.itemId === i.id)
          .map((r) => ({
            id: encodeId('planRequest', r.id),
            kind: r.kind,
            message: r.message,
            assigneeUserId: r.assigneeUserId ? encodeId('user', r.assigneeUserId) : null,
            status: r.status,
            fileIds: r.fileIds.map((f) => encodeId('file', f)),
            createdAt: r.createdAt.toISOString(),
          })),
        note: i.note,
        completedAt: i.completedAt ? i.completedAt.toISOString() : null,
        holdCleared: i.holdClearedAt !== null,
        holdClearedAt: i.holdClearedAt ? i.holdClearedAt.toISOString() : null,
        holdNote: i.holdNote,
        canClearHold: hold && i.status !== 'complete' && clearer && blockers.length === 0,
      };
    };

    return {
      started: phaseRows.length > 0,
      canManage,
      canClearHolds: clearer,
      phases: phaseRows.map((p) => {
        const mine = itemRows.filter((i) => i.phaseId === p.id).map(toItem);
        return {
          id: encodeId('planPhase', p.id),
          number: p.position,
          title: p.title,
          doneCount: mine.filter((i) => i.status === 'complete').length,
          items: mine,
        };
      }),
    };
  }

  async function phaseOf(
    scope: TenantScope,
    projectId: string,
    phaseId: string,
  ): Promise<PhaseRow> {
    const [p] = await scope.tx
      .select()
      .from(phases)
      .where(and(eq(phases.id, phaseId), eq(phases.projectId, projectId), isNull(phases.deletedAt)))
      .limit(1);
    if (!p) throw new AppError('project_plan.phase_not_found');
    return p;
  }
  async function itemOf(scope: TenantScope, projectId: string, itemId: string): Promise<ItemRow> {
    const [i] = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.projectId, projectId), isNull(items.deletedAt)))
      .limit(1);
    if (!i) throw new AppError('project_plan.item_not_found');
    return i;
  }

  async function resequencePhases(scope: TenantScope, projectId: string, order: readonly string[]) {
    for (const [n, id] of order.entries())
      await scope.tx
        .update(phases)
        .set({ position: n + 1, updatedAt: now() })
        .where(and(eq(phases.id, id), eq(phases.projectId, projectId)));
  }
  async function resequenceItems(scope: TenantScope, phaseId: string) {
    const rows = await scope.tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.phaseId, phaseId), isNull(items.deletedAt)))
      .orderBy(asc(items.position), asc(items.id));
    for (const [n, r] of rows.entries())
      await scope.tx
        .update(items)
        .set({ position: n + 1 })
        .where(eq(items.id, r.id));
  }

  function cleanParties(input: readonly PlanPartyInput[] | undefined): Party[] {
    return (input ?? []).map((p, n) => ({
      kind: p.kind,
      companyId: p.companyId
        ? (decodeId('company', p.companyId) ?? bad(`parties/${n}/companyId`))
        : null,
      userIds: (p.userIds ?? []).map((u, k) => decodeUser(u, `parties/${n}/userIds/${k}`)),
      label: (p.label ?? '').trim(),
      confirmed: p.confirmed ?? false,
    }));
  }
  const bad = (path: string): never => {
    throw invalid(path, 'Invalid id');
  };

  function cleanRefs(
    input: NonNullable<UpdatePlanItemRequest['references']> | undefined,
  ): StoredReference[] {
    return (input ?? []).map((r, n) => ({
      label: r.label.trim(),
      url: r.url ?? null,
      fileId: r.fileId ? (decodeId('file', r.fileId) ?? bad(`references/${n}/fileId`)) : null,
    }));
  }

  async function cleanLinks(
    scope: TenantScope,
    projectId: string,
    input: readonly PlanLinkInput[] | undefined,
  ): Promise<StoredLink[]> {
    const out: StoredLink[] = [];
    const seen = new Set<string>();
    for (const [n, l] of (input ?? []).entries()) {
      const kind = LINK_KIND[l.type];
      if (kind ? decodeId(kind, l.id) === null : !/^[a-z]{3}_[0-9A-Za-z]{26}$/.test(l.id))
        throw invalid(`links/${n}/id`, 'Not an id of that kind');
      if (seen.has(`${l.type}:${l.id}`)) continue;
      seen.add(`${l.type}:${l.id}`);
      let label = (l.label ?? '').trim();
      let ref = '';
      const src = deps.records[l.type];
      if (src && kind) {
        // Take the name from the record itself when it can be found, so a label can't misdescribe it.
        const { hits } = await src.searchHits(scope, projectId, '', RECORD_WINDOW);
        const uuid = decodeId(kind, l.id)!;
        const hit = hits.find((h) => h.id === uuid);
        if (hit) {
          label = hit.title;
          ref = hit.ref;
        }
      }
      out.push({ type: l.type, id: l.id, label: label || l.id, ref });
    }
    return out;
  }

  const typesOf = (t: readonly string[] | undefined) => [...new Set(t ?? [])] as ItemType[];

  async function start(scope: TenantScope, projectId: string) {
    if ((await allPhases(scope, projectId)).length > 0)
      throw new AppError('project_plan.already_started');
    const base = await today(scope, projectId);
    for (const [pn, ph] of STANDARD_PLAN.entries()) {
      const phaseId = uuidv7();
      await scope.tx.insert(phases).values({
        id: phaseId,
        orgId: scope.ctx.orgId,
        projectId,
        position: pn + 1,
        title: ph.title,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
      for (const [n, it] of ph.items.entries())
        await scope.tx.insert(items).values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          phaseId,
          position: n + 1,
          title: it.title,
          outcome: it.outcome,
          itemTypes: it.types,
          dueDate: addDays(base, it.dueOffsetDays),
          parties: [
            ...(it.internal
              ? [
                  {
                    kind: 'internal' as const,
                    companyId: null,
                    userIds: [],
                    label: '',
                    confirmed: false,
                  },
                ]
              : []),
            ...(it.thirdParty
              ? [
                  {
                    kind: 'third_party' as const,
                    companyId: null,
                    userIds: [],
                    label: '',
                    confirmed: false,
                  },
                ]
              : []),
          ],
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        });
    }
    return view(scope, projectId);
  }

  async function createPhase(scope: TenantScope, projectId: string, title: string) {
    await deps.platform.getProject(scope, projectId);
    const rows = await allPhases(scope, projectId);
    await scope.tx.insert(phases).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      position: rows.length + 1,
      title: title.trim(),
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return view(scope, projectId);
  }

  async function updatePhase(
    scope: TenantScope,
    projectId: string,
    phaseId: string,
    input: { title?: string; position?: number },
  ) {
    await phaseOf(scope, projectId, phaseId);
    if (input.title !== undefined)
      await scope.tx
        .update(phases)
        .set({
          title: input.title.trim(),
          updatedAt: now(),
          updatedBy: scope.ctx.userId,
          version: sql`${phases.version} + 1`,
        })
        .where(eq(phases.id, phaseId));
    if (input.position !== undefined) {
      const order = (await allPhases(scope, projectId))
        .map((p) => p.id)
        .filter((id) => id !== phaseId);
      order.splice(Math.min(input.position, order.length + 1) - 1, 0, phaseId);
      await resequencePhases(scope, projectId, order);
    }
    return view(scope, projectId);
  }

  async function deletePhase(scope: TenantScope, projectId: string, phaseId: string) {
    await phaseOf(scope, projectId, phaseId);
    const [n] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(items)
      .where(and(eq(items.phaseId, phaseId), isNull(items.deletedAt)));
    if ((n?.n ?? 0) > 0)
      throw new AppError('project_plan.phase_not_empty', 'Remove or move the phase’s items first.');
    await scope.tx
      .update(phases)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(phases.id, phaseId));
    await resequencePhases(
      scope,
      projectId,
      (await allPhases(scope, projectId)).map((p) => p.id),
    );
    return view(scope, projectId);
  }

  async function createItem(
    scope: TenantScope,
    projectId: string,
    phaseId: string,
    input: CreatePlanItemRequest,
  ) {
    await phaseOf(scope, projectId, phaseId);
    const [last] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${items.position}), 0)::int` })
      .from(items)
      .where(and(eq(items.phaseId, phaseId), isNull(items.deletedAt)));
    await scope.tx.insert(items).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      phaseId,
      position: (last?.n ?? 0) + 1,
      title: input.title.trim(),
      outcome: (input.outcome ?? '').trim(),
      itemTypes: typesOf(input.types),
      dueDate: input.dueDate ?? null,
      parties: cleanParties(input.parties),
      referenceDocs: cleanRefs(input.references),
      links: await cleanLinks(scope, projectId, input.links),
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return view(scope, projectId);
  }

  /** Items in plan order with the facts the hold rules need. */
  async function flatPlan(scope: TenantScope, projectId: string) {
    const [ps, is] = await Promise.all([allPhases(scope, projectId), allItems(scope, projectId)]);
    const no = new Map(ps.map((p) => [p.id, p.position]));
    return is
      .filter((i) => no.has(i.phaseId))
      .map<FlatItem>((i) => ({
        id: i.id,
        phaseId: i.phaseId,
        phasePosition: no.get(i.phaseId)!,
        position: i.position,
        status: i.status,
        types: i.itemTypes,
        holdCleared: i.holdClearedAt !== null,
      }));
  }

  async function updateItem(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    input: UpdatePlanItemRequest,
  ) {
    const cur = await itemOf(scope, projectId, itemId);
    const set: Partial<typeof items.$inferInsert> = {
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
      version: sql`${items.version} + 1` as unknown as number,
    };
    if (input.title !== undefined) set.title = input.title.trim();
    if (input.outcome !== undefined) set.outcome = input.outcome.trim();
    if (input.dueDate !== undefined) set.dueDate = input.dueDate;
    if (input.note !== undefined) set.note = input.note;
    if (input.parties !== undefined) set.parties = cleanParties(input.parties);
    if (input.references !== undefined) set.referenceDocs = cleanRefs(input.references);
    if (input.links !== undefined) set.links = await cleanLinks(scope, projectId, input.links);
    const types = input.types !== undefined ? typesOf(input.types) : cur.itemTypes;
    if (input.types !== undefined) set.itemTypes = types;

    const status = input.status ?? cur.status;
    if (input.status !== undefined && input.status !== cur.status) {
      if (status === 'complete') {
        if (isHold(types))
          throw new AppError(
            'project_plan.hold_point_needs_clearing',
            'A hold point is completed by clearing it.',
          );
        const flat = await flatPlan(scope, projectId);
        const me = flat.find((f) => f.id === itemId)!;
        const holds = blockingHolds(flat, me);
        if (holds.length)
          throw new AppError(
            'project_plan.blocked_by_hold',
            'An earlier hold point has not been cleared.',
          );
        set.completedAt = now();
        set.completedBy = scope.ctx.userId;
      } else if (cur.status === 'complete') {
        set.completedAt = null;
        set.completedBy = null;
        // Reopening a hold point puts the hold back.
        set.holdClearedAt = null;
        set.holdClearedBy = null;
        set.holdNote = null;
      }
      set.status = status;
    }
    // An item completed before it became a hold point counts as cleared when it was completed.
    if (isHold(types) && status === 'complete' && !cur.holdClearedAt && !set.holdClearedAt)
      set.holdClearedAt = cur.completedAt ?? now();

    if (input.phaseId !== undefined) {
      const target = decodeId('planPhase', input.phaseId) ?? bad('phaseId');
      if (target !== cur.phaseId) {
        await phaseOf(scope, projectId, target);
        const [last] = await scope.tx
          .select({ n: sql<number>`coalesce(max(${items.position}), 0)::int` })
          .from(items)
          .where(and(eq(items.phaseId, target), isNull(items.deletedAt)));
        set.phaseId = target;
        set.position = (last?.n ?? 0) + 1;
      }
    }
    await scope.tx.update(items).set(set).where(eq(items.id, itemId));
    if (set.phaseId) await resequenceItems(scope, cur.phaseId);
    return view(scope, projectId);
  }

  async function deleteItem(scope: TenantScope, projectId: string, itemId: string) {
    const cur = await itemOf(scope, projectId, itemId);
    await scope.tx
      .update(items)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(items.id, itemId));
    await resequenceItems(scope, cur.phaseId);
    return view(scope, projectId);
  }

  async function clearHold(scope: TenantScope, projectId: string, itemId: string, note?: string) {
    const cur = await itemOf(scope, projectId, itemId);
    if (!isHold(cur.itemTypes)) throw new AppError('project_plan.not_a_hold_point');
    if (cur.holdClearedAt) throw new AppError('project_plan.hold_already_cleared');
    const flat = await flatPlan(scope, projectId);
    const me = flat.find((f) => f.id === itemId)!;
    if (blockingHolds(flat, me).length)
      throw new AppError(
        'project_plan.blocked_by_hold',
        'An earlier hold point has not been cleared.',
      );
    const at = now();
    await scope.tx
      .update(items)
      .set({
        status: 'complete',
        completedAt: at,
        completedBy: scope.ctx.userId,
        holdClearedAt: at,
        holdClearedBy: scope.ctx.userId,
        holdNote: note?.trim() || null,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
        version: sql`${items.version} + 1` as unknown as number,
      })
      .where(eq(items.id, itemId));
    return view(scope, projectId);
  }

  async function createRequest(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    input: { kind: 'attachment' | 'photo'; message?: string; assigneeUserId?: string },
  ) {
    const cur = await itemOf(scope, projectId, itemId);
    const assignee = input.assigneeUserId
      ? decodeUser(input.assigneeUserId, 'assigneeUserId')
      : (cur.parties.flatMap((p) => p.userIds)[0] ?? null);
    const id = uuidv7();
    await scope.tx.insert(requests).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      itemId,
      kind: input.kind,
      message: (input.message ?? '').trim(),
      assigneeUserId: assignee,
      requestedBy: scope.ctx.userId,
    });
    if (assignee)
      await createNotifications(scope, [
        {
          userId: assignee,
          projectId,
          kind: 'projectplan.request',
          entityType: 'project_plan_item',
          entityId: itemId,
          title: `${input.kind === 'photo' ? 'Photos' : 'An attachment'} requested for "${cur.title}"`,
          body: (input.message ?? '').trim().slice(0, 200),
          dedupeKey: `projectplan.request:${id}`,
        },
      ]);
    return view(scope, projectId);
  }

  async function fulfilRequest(
    scope: TenantScope,
    projectId: string,
    requestId: string,
    fileIds: readonly string[],
  ) {
    const [r] = await scope.tx
      .select()
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.projectId, projectId)))
      .limit(1);
    if (!r) throw new AppError('project_plan.request_not_found');
    const manages = await deps.access.can(scope, 'projectplan.plan.write', { projectId });
    if (!manages && r.assigneeUserId !== scope.ctx.userId)
      throw new AppError('project_plan.request_not_found');
    if (r.status !== 'open') throw new AppError('project_plan.request_not_found');
    const ids: string[] = [];
    for (const [n, f] of fileIds.entries()) {
      const uuid = decodeId('file', f) ?? bad(`fileIds/${n}`);
      const file = await deps.files.getFile(scope, uuid);
      if (file.projectId !== projectId || file.status !== 'ready')
        throw invalid(`fileIds/${n}`, 'Attach files uploaded to this project.');
      ids.push(uuid);
    }
    await scope.tx
      .update(requests)
      .set({ status: 'fulfilled', fileIds: ids, fulfilledAt: now(), fulfilledBy: scope.ctx.userId })
      .where(eq(requests.id, requestId));
    return view(scope, projectId);
  }

  async function linkOptions(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    type: LinkType,
    q: string,
  ) {
    const cur = await itemOf(scope, projectId, itemId);
    const src = deps.records[type];
    if (!src) return { data: [], restricted: false };
    const { restricted, hits } = await src.searchHits(scope, projectId, q, RECORD_WINDOW);
    const data = hits
      .map((h) => ({
        type,
        id: encodeLinkId(type, h.id),
        ref: h.ref,
        title: h.title,
        status: h.status,
        score: Math.round(titleMatch(cur.title, h.title) * 100) / 100,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    return { data, restricted };
  }

  async function insights(scope: TenantScope, projectId: string) {
    const [ps, is, todayStr] = await Promise.all([
      allPhases(scope, projectId),
      allItems(scope, projectId),
      today(scope, projectId),
    ]);
    const phaseOfItem = new Map(ps.map((p) => [p.id, p]));
    const rows: (InsightItem & { links: StoredLink[] })[] = is
      .filter((i) => phaseOfItem.has(i.phaseId))
      .map((i) => {
        const p = phaseOfItem.get(i.phaseId)!;
        return {
          id: i.id,
          phaseId: i.phaseId,
          phasePosition: p.position,
          phaseTitle: p.title,
          position: i.position,
          status: i.status,
          types: i.itemTypes,
          holdCleared: i.holdClearedAt !== null,
          number: itemNumber(p.position, i.position),
          title: i.title,
          dueDate: i.dueDate,
          links: i.links,
        };
      })
      .sort(planOrder);
    const base = insightsFor(rows, todayStr);
    const enc = (id: string) => encodeId('planItem', id);

    // Items of a linkable type with no link of that type yet: look for a record with a similar name.
    const suggestions: {
      itemId: string;
      number: string;
      itemTitle: string;
      link: Awaited<ReturnType<typeof linkOptions>>['data'][number];
      score: number;
    }[] = [];
    const cache = new Map<LinkType, readonly SearchHit[]>();
    for (const r of rows) {
      if (r.status === 'complete') continue;
      for (const t of r.types) {
        const lt = TYPE_TO_LINK[t as ItemType];
        const src = lt ? deps.records[lt] : undefined;
        if (!lt || !src || r.links.some((l) => l.type === lt)) continue;
        if (!cache.has(lt))
          cache.set(lt, (await src.searchHits(scope, projectId, '', RECORD_WINDOW)).hits);
        let best: { h: SearchHit; score: number } | null = null;
        for (const h of cache.get(lt)!) {
          const score = titleMatch(r.title, h.title);
          if (score >= SUGGEST_THRESHOLD && (!best || score > best.score)) best = { h, score };
        }
        if (best)
          suggestions.push({
            itemId: enc(r.id),
            number: r.number,
            itemTitle: r.title,
            score: Math.round(best.score * 100) / 100,
            link: {
              type: lt,
              id: encodeLinkId(lt, best.h.id),
              ref: best.h.ref,
              title: best.h.title,
              status: best.h.status,
              score: Math.round(best.score * 100) / 100,
            },
          });
      }
    }
    return {
      overdue: base.overdue.map((o) => ({ ...o, itemId: enc(o.itemId) })),
      atRisk: base.atRisk.map((o) => ({ ...o, itemId: enc(o.itemId) })),
      blockedByHold: base.blockedByHold.map((b) => ({ ...b, holdItemId: enc(b.holdItemId) })),
      suggestedLinks: suggestions.sort((a, b) => b.score - a.score).slice(0, 20),
    };
  }

  async function phaseSummary(scope: TenantScope, projectId: string, phaseId: string) {
    const p = await phaseOf(scope, projectId, phaseId);
    const rows = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.phaseId, phaseId), isNull(items.deletedAt)))
      .orderBy(asc(items.position));
    const text = draftPhaseSummary(
      {
        number: p.position,
        title: p.title,
        items: rows.map((i) => ({
          number: itemNumber(p.position, i.position),
          title: i.title,
          status: i.status,
          dueDate: i.dueDate,
          types: i.itemTypes,
          holdCleared: i.holdClearedAt !== null,
        })),
      },
      await today(scope, projectId),
    );
    return { phaseId: encodeId('planPhase', phaseId), text };
  }

  return {
    view,
    start,
    createPhase,
    updatePhase,
    deletePhase,
    createItem,
    updateItem,
    deleteItem,
    clearHold,
    createRequest,
    fulfilRequest,
    linkOptions,
    insights,
    phaseSummary,
  };
}

export type ProjectPlanService = ReturnType<typeof createProjectPlanService>;
