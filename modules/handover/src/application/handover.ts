import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { uuidv7 } from '@archova/domain';
import { AppError, nextNumber, versionConflict, type TenantScope } from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  DEFAULT_TEMPLATE,
  handoverFlags,
  handoverLabel,
  handoverState,
  handoverTransition,
  isComplete,
  readyToIssue,
  summarise,
  type HandoverAction,
  type HandoverCategory,
  type HandoverState,
  type HandoverStatus,
  type Signals,
} from '../domain/handover';
import { itemEvents, issues, items, type IssueSnapshotItem } from '../infra/tables';

export type ItemRow = typeof items.$inferSelect;
export type ItemEventRow = typeof itemEvents.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export interface ItemView extends ItemRow {
  state: HandoverState;
}

export interface HandoverDeps {
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  /** What other modules know (open defects, warranty register, occupation certificate). Provided by compose. */
  signals?: (scope: TenantScope, projectId: string) => Promise<Signals>;
  now?: () => Date;
}

export interface ItemFields {
  category?: HandoverCategory;
  title?: string;
  description?: string | null;
  required?: boolean;
  responsibleCompanyId?: string | null;
  dueOn?: string | null;
  note?: string | null;
  fileIds?: string[];
}

const trimOrNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const NO_SIGNALS: Signals = { openDefects: null, warrantyItems: null, occupationCertificate: null };

export function createHandoverService(deps: HandoverDeps) {
  const now = deps.now ?? (() => new Date());

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  const view = (r: ItemRow, day: ReturnType<typeof localDateOf>): ItemView => ({
    ...r,
    state: handoverState(r, day),
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
        { path: 'responsibleCompanyId', message: 'Not a company on the project' },
      ]);
  }

  async function record(
    scope: TenantScope,
    row: ItemRow,
    e: { action: string; from: HandoverStatus | null; note?: string | null },
  ) {
    await scope.tx.insert(itemEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      itemId: row.id,
      action: e.action,
      fromStatus: e.from,
      toStatus: row.status,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  function changed(scope: TenantScope, r: ItemRow) {
    scope.events.add({
      type: 'handover.item.changed.v1',
      projectId: r.projectId,
      entityType: 'handover_item',
      entityId: r.id,
      entityVersion: r.version,
      data: { itemId: r.id, category: r.category, status: r.status },
    });
  }

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.projectId, projectId), isNull(items.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('handover.item_not_found');
    return row;
  }

  async function allRows(scope: TenantScope, projectId: string) {
    return scope.tx
      .select()
      .from(items)
      .where(and(eq(items.projectId, projectId), isNull(items.deletedAt)))
      .orderBy(asc(items.number));
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(itemEvents)
      .where(eq(itemEvents.itemId, id))
      .orderBy(asc(itemEvents.at), asc(itemEvents.id));
    return { item: view(row, await today(scope, projectId)), events };
  }

  function assertFileCap(ids: string[] | undefined) {
    if (ids && new Set(ids).size > 10)
      throw new AppError('validation_failed', 'Attach up to 10 files to one item.', [
        { path: 'fileIds', message: 'At most 10' },
      ]);
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: ItemFields & { category: HandoverCategory; title: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (input.responsibleCompanyId)
      await checkCompany(scope, projectId, input.responsibleCompanyId);
    assertFileCap(input.fileIds);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'handover_item');
    const [row] = await scope.tx
      .insert(items)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        category: input.category,
        title: input.title.trim(),
        description: trimOrNull(input.description),
        required: input.required ?? true,
        responsibleCompanyId: input.responsibleCompanyId ?? null,
        dueOn: input.dueOn ?? null,
        note: trimOrNull(input.note),
        fileIds: [...new Set(input.fileIds ?? [])],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await record(scope, row!, { action: 'add', from: null });
    changed(scope, row!);
    return detail(scope, projectId, id);
  }

  /** Adds the standard list. Items whose title is already on the checklist are skipped, so it is safe to repeat. */
  async function applyTemplate(scope: TenantScope, projectId: string) {
    await deps.platform.getProject(scope, projectId);
    const existing = new Set((await allRows(scope, projectId)).map((r) => r.title.toLowerCase()));
    let added = 0;
    for (const t of DEFAULT_TEMPLATE) {
      if (existing.has(t.title.toLowerCase())) continue;
      const number = await nextNumber(scope, projectId, 'handover_item');
      const [row] = await scope.tx
        .insert(items)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          number,
          category: t.category,
          title: t.title,
          required: t.required,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      await record(scope, row!, { action: 'add', from: null, note: 'Standard list' });
      changed(scope, row!);
      added += 1;
    }
    return { added };
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: ItemFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.responsibleCompanyId)
      await checkCompany(scope, projectId, patch.responsibleCompanyId);
    assertFileCap(patch.fileIds);
    if (patch.fileIds?.length) await checkFiles(scope, projectId, patch.fileIds);
    // An approved item is a record: swapping its files would make the approval cover something else.
    if (row.status === 'approved' && patch.fileIds !== undefined)
      throw new AppError(
        'handover.invalid_transition',
        'Reopen an approved item before changing its files.',
        undefined,
        {
          status: row.status,
        },
      );
    const [next] = await scope.tx
      .update(items)
      .set({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: trimOrNull(patch.description) } : {}),
        ...(patch.required !== undefined ? { required: patch.required } : {}),
        ...(patch.responsibleCompanyId !== undefined
          ? { responsibleCompanyId: patch.responsibleCompanyId }
          : {}),
        ...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
        ...(patch.note !== undefined ? { note: trimOrNull(patch.note) } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, { action: 'edit', from: row.status });
    changed(scope, next);
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: HandoverAction; note?: string | null },
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    const result = handoverTransition(row.status, input.action, {
      fileCount: row.fileIds.length,
      note: input.note ?? null,
    });
    if (!result.ok)
      throw new AppError('handover.invalid_transition', result.reason, undefined, {
        status: row.status,
      });
    const day = await today(scope, projectId);
    const to = result.to;
    const [next] = await scope.tx
      .update(items)
      .set({
        status: to,
        receivedOn: to === 'received' ? day : to === 'outstanding' ? null : row.receivedOn,
        approvedOn: to === 'approved' ? day : null,
        approvedBy: to === 'approved' ? scope.ctx.userId : null,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(items.id, id), eq(items.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, {
      action: input.action,
      from: row.status,
      note: trimOrNull(input.note),
    });
    changed(scope, next);
    return detail(scope, projectId, id);
  }

  async function signalsFor(scope: TenantScope, projectId: string): Promise<Signals> {
    return deps.signals ? deps.signals(scope, projectId) : NO_SIGNALS;
  }

  const flagItems = (rows: ItemRow[]) =>
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      category: r.category,
      required: r.required,
      status: r.status,
      dueOn: r.dueOn,
      responsibleCompanyId: r.responsibleCompanyId,
      fileCount: r.fileIds.length,
      receivedOn: r.receivedOn,
    }));

  /** The checklist, its progress, Nova's flags and what has been issued. One read: a project has tens of items. */
  async function pack(scope: TenantScope, projectId: string) {
    const day = await today(scope, projectId);
    const rows = await allRows(scope, projectId);
    const summary = summarise(rows, day);
    const flags = handoverFlags(flagItems(rows), await signalsFor(scope, projectId), day);
    const past = await scope.tx
      .select({
        id: issues.id,
        projectId: issues.projectId,
        recipientName: issues.recipientName,
        note: issues.note,
        incompleteCount: issues.incompleteCount,
        issuedBy: issues.issuedBy,
        issuedAt: issues.issuedAt,
      })
      .from(issues)
      .where(eq(issues.projectId, projectId))
      .orderBy(desc(issues.issuedAt))
      .limit(20);
    return {
      items: rows.map((r) => view(r, day)),
      summary,
      readyToIssue: readyToIssue(summary),
      flags,
      issues: past,
    };
  }

  async function flags(scope: TenantScope, projectId: string) {
    const day = await today(scope, projectId);
    return handoverFlags(
      flagItems(await allRows(scope, projectId)),
      await signalsFor(scope, projectId),
      day,
    );
  }

  /** What the client receives: every item with the files that back it. */
  async function exportManifest(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    const day = await today(scope, projectId);
    const rows = await allRows(scope, projectId);
    const files = await resolveFiles(scope, projectId, rows);
    const summary = summarise(rows, day);
    return {
      project: { name: project.name },
      generatedAt: now(),
      summary,
      items: rows.map((r) => snapshotItem(r, files)),
    };
  }

  async function resolveFiles(scope: TenantScope, projectId: string, rows: ItemRow[]) {
    const ids = [...new Set(rows.flatMap((r) => r.fileIds))];
    const out = new Map<string, { id: string; filename: string; sizeBytes: number }>();
    for (const id of ids) {
      // A file removed since it was attached is left out of the copy rather than failing the whole pack.
      const f = await deps.files.getFile(scope, id).catch((e: unknown) => {
        if (e instanceof AppError && e.code === 'file.not_found') return null;
        throw e;
      });
      if (f && f.projectId === projectId)
        out.set(id, { id, filename: f.filename, sizeBytes: Number(f.sizeBytes) });
    }
    return out;
  }

  const snapshotItem = (
    r: ItemRow,
    files: Map<string, { id: string; filename: string; sizeBytes: number }>,
  ): IssueSnapshotItem => ({
    numberLabel: handoverLabel(r.number),
    category: r.category,
    title: r.title,
    required: r.required,
    status: r.status,
    files: r.fileIds.flatMap((f) => files.get(f) ?? []),
  });

  /**
   * Records that the pack went to the client, with a frozen copy of the checklist. Required items that are not yet
   * approved or marked not applicable block it unless the issuer says so (`acknowledgeIncomplete`).
   */
  async function issue(
    scope: TenantScope,
    projectId: string,
    input: { recipientName: string; note?: string | null; acknowledgeIncomplete?: boolean },
  ) {
    const day = await today(scope, projectId);
    const rows = await allRows(scope, projectId);
    if (rows.length === 0)
      throw new AppError('handover.nothing_to_issue', 'Add items to the checklist first.');
    const incomplete = rows.filter((r) => r.required && !isComplete(r.status)).length;
    if (incomplete > 0 && !input.acknowledgeIncomplete)
      throw new AppError(
        'handover.incomplete',
        `${incomplete} required item${incomplete === 1 ? ' is' : 's are'} not complete. Confirm to issue anyway.`,
        undefined,
        { incomplete },
      );
    const files = await resolveFiles(scope, projectId, rows);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(issues)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        recipientName: input.recipientName.trim(),
        note: trimOrNull(input.note),
        incompleteCount: incomplete,
        snapshot: { items: rows.map((r) => snapshotItem(r, files)) },
        issuedBy: scope.ctx.userId,
        issuedAt: now(),
      })
      .returning();
    scope.events.add({
      type: 'handover.pack.issued.v1',
      projectId,
      entityType: 'handover_issue',
      entityId: id,
      entityVersion: 1,
      data: { issueId: id, incomplete, on: day },
    });
    return row!;
  }

  return { pack, flags, create, applyTemplate, detail, update, transition, exportManifest, issue };
}

export type HandoverService = ReturnType<typeof createHandoverService>;
