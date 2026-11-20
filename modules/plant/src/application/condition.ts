import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import { localDateOf } from '@archova/time';
import { MAX_CONDITION_PHOTOS, type ConditionKind } from '../domain/plant';
import { allocations, assets, conditionChecks, maintenanceRecords } from '../infra/tables';

export type ConditionRow = typeof conditionChecks.$inferSelect;

export interface ConditionDeps {
  access: AccessService;
  /** Condition photos: each must be a ready file the plant module uploaded. */
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface ConditionInput {
  kind: ConditionKind;
  fileIds: string[];
  note?: string | undefined;
  allocationId?: string | undefined;
  recordId?: string | undefined;
}

const MAX_ROWS = 500;
const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

/** Photos of a machine's condition at hire-in, hire-out and after a service. */
export function createConditionService(deps: ConditionDeps, timeZone: string) {
  const now = deps.now ?? (() => new Date());

  async function list(scope: TenantScope, assetId: string) {
    await deps.access.assert(scope, 'plant.assets.view');
    await assertAsset(scope, assetId);
    return scope.tx
      .select()
      .from(conditionChecks)
      .where(eq(conditionChecks.assetId, assetId))
      .orderBy(desc(conditionChecks.takenOn), desc(conditionChecks.id))
      .limit(MAX_ROWS);
  }

  async function assertAsset(scope: TenantScope, assetId: string) {
    const [a] = await scope.tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!a) throw new AppError('plant.asset_not_found');
  }

  async function record(scope: TenantScope, assetId: string, input: ConditionInput) {
    await deps.access.assert(scope, 'plant.assets.manage');
    await assertAsset(scope, assetId);
    const fileIds = [...new Set(input.fileIds)];
    if (fileIds.length < 1 || fileIds.length > MAX_CONDITION_PHOTOS)
      throw invalid('fileIds', `Add between 1 and ${MAX_CONDITION_PHOTOS} photos.`);
    if (input.allocationId && input.kind === 'service')
      throw invalid('allocationId', 'A service photo is not tied to an allocation.');
    if (input.recordId && input.kind !== 'service')
      throw invalid('recordId', 'Only a service photo is tied to a maintenance record.');
    if (input.allocationId) {
      const [a] = await scope.tx
        .select({ id: allocations.id })
        .from(allocations)
        .where(and(eq(allocations.id, input.allocationId), eq(allocations.assetId, assetId)))
        .limit(1);
      if (!a) throw new AppError('plant.allocation_not_found');
    }
    if (input.recordId) {
      const [r] = await scope.tx
        .select({ id: maintenanceRecords.id })
        .from(maintenanceRecords)
        .where(
          and(eq(maintenanceRecords.id, input.recordId), eq(maintenanceRecords.assetId, assetId)),
        )
        .limit(1);
      if (!r) throw invalid('recordId', 'Not a service record of this machine.');
    }
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== null || f.module !== 'plant' || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach photos uploaded for plant.', [
          { path: `fileIds/${i}`, message: 'Not a ready plant photo' },
        ]);
    }
    const [row] = await scope.tx
      .insert(conditionChecks)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        assetId,
        kind: input.kind,
        allocationId: input.allocationId ?? null,
        recordId: input.recordId ?? null,
        takenOn: localDateOf(now(), timeZone),
        note: input.note?.trim() || null,
        fileIds,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  return { list, record };
}

export type ConditionService = ReturnType<typeof createConditionService>;
