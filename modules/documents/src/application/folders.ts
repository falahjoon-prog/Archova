import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { hiddenFolderIds } from '../domain/folders';
import { folders } from '../infra/tables';
import type { DocumentsContext } from './context';
import { uniqueViolation } from './errors';

type FolderRow = typeof folders.$inferSelect;

export interface FolderInput {
  name: string;
  parentId?: string | null;
  isPrivate?: boolean;
  allowedUserIds?: string[];
  allowedCompanyIds?: string[];
}

export function createFolderService(c: DocumentsContext) {
  async function all(scope: TenantScope, projectId: string): Promise<FolderRow[]> {
    return scope.tx
      .select()
      .from(folders)
      .where(and(eq(folders.projectId, projectId), isNull(folders.deletedAt)))
      .orderBy(folders.name);
  }

  /** Folder ids the caller may not open in this project (private folders and everything under them). */
  async function hiddenIds(scope: TenantScope, projectId: string, rows?: FolderRow[]) {
    const list = rows ?? (await all(scope, projectId));
    if (!list.some((f) => f.isPrivate)) return new Set<string>();
    const v = await c.viewer(scope, projectId);
    const seesPrivate = await c.access.can(scope, 'documents.folders.restrict', { projectId });
    return hiddenFolderIds(list, { ...v, seesPrivate });
  }

  async function list(scope: TenantScope, projectId: string) {
    await c.requireProject(scope, projectId);
    const rows = await all(scope, projectId);
    const hidden = await hiddenIds(scope, projectId, rows);
    return rows.filter((f) => !hidden.has(f.id));
  }

  /** Mobile pull (modules/sync): the folders among `ids` the caller may open; the rest go out as deletes. */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    const wanted = new Set(ids);
    return (await list(scope, projectId)).filter((f) => wanted.has(f.id));
  }

  /** A folder the caller can open; hidden folders are a 404, like folders in other projects. */
  async function getVisible(scope: TenantScope, projectId: string, folderId: string) {
    const rows = await all(scope, projectId);
    const row = rows.find((f) => f.id === folderId);
    if (!row || (await hiddenIds(scope, projectId, rows)).has(folderId))
      throw new AppError('folder.not_found');
    return row;
  }

  async function assertCanRestrict(scope: TenantScope, projectId: string, input: FolderInput) {
    if (
      input.isPrivate !== undefined ||
      input.allowedUserIds !== undefined ||
      input.allowedCompanyIds !== undefined
    ) {
      await c.access.assert(scope, 'documents.folders.restrict', { projectId });
    }
  }

  async function create(scope: TenantScope, projectId: string, input: FolderInput) {
    await c.requireProject(scope, projectId);
    await assertCanRestrict(scope, projectId, input);
    if (input.parentId) await getVisible(scope, projectId, input.parentId);
    const id = uuidv7();
    let row: FolderRow;
    try {
      [row] = (await scope.tx
        .insert(folders)
        .values({
          id,
          orgId: scope.ctx.orgId,
          projectId,
          parentId: input.parentId ?? null,
          name: input.name.trim(),
          isPrivate: input.isPrivate ?? false,
          allowedUserIds: input.allowedUserIds ?? [],
          allowedCompanyIds: input.allowedCompanyIds ?? [],
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning()) as [FolderRow];
    } catch (e) {
      if (uniqueViolation(e) === 'folders_name') throw nameTaken();
      throw e;
    }
    await scope.recordChange({
      module: 'documents',
      entityType: 'folder',
      entityId: id,
      op: 'upsert',
      version: 1,
      projectId,
      isPrivate: row.isPrivate,
    });
    scope.events.add({
      type: 'documents.folder.created.v1',
      projectId,
      entityType: 'folder',
      entityId: id,
      entityVersion: 1,
      data: { folderId: id, parentId: row.parentId, isPrivate: row.isPrivate },
    });
    return row;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    folderId: string,
    expectedVersion: number,
    input: Partial<FolderInput>,
  ) {
    await assertCanRestrict(scope, projectId, { name: '', ...input });
    const current = await getVisible(scope, projectId, folderId);
    if (current.version !== expectedVersion) throw versionConflict();
    const values: Partial<typeof folders.$inferInsert> = {
      updatedBy: scope.ctx.userId,
      version: current.version + 1,
    };
    if (input.name !== undefined) values.name = input.name.trim();
    if (input.isPrivate !== undefined) values.isPrivate = input.isPrivate;
    if (input.allowedUserIds !== undefined) values.allowedUserIds = input.allowedUserIds;
    if (input.allowedCompanyIds !== undefined) values.allowedCompanyIds = input.allowedCompanyIds;
    let rows: FolderRow[];
    try {
      rows = await scope.tx
        .update(folders)
        .set(values)
        .where(and(eq(folders.id, folderId), eq(folders.version, expectedVersion)))
        .returning();
    } catch (e) {
      if (uniqueViolation(e) === 'folders_name') throw nameTaken();
      throw e;
    }
    const row = rows[0];
    if (!row) throw versionConflict();
    await scope.recordChange({
      module: 'documents',
      entityType: 'folder',
      entityId: folderId,
      op: 'upsert',
      version: row.version,
      projectId,
      isPrivate: row.isPrivate,
    });
    scope.events.add({
      type: 'documents.folder.updated.v1',
      projectId,
      entityType: 'folder',
      entityId: folderId,
      entityVersion: row.version,
      data: { folderId, changed: Object.keys(input) },
    });
    return row;
  }

  return { list, visibleAmong, getVisible, hiddenIds, create, update };
}

const nameTaken = () =>
  new AppError('folder.name_taken', 'A folder with that name already exists here.');

export type FolderService = ReturnType<typeof createFolderService>;
