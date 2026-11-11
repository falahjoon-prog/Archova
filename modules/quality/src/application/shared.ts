import { and, eq, isNull } from 'drizzle-orm';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { DocumentsApi } from '@archova/mod-documents';
import type { PlatformApi } from '@archova/mod-platform';
import { observations } from '../infra/tables';

export interface QualityDeps {
  access: AccessService;
  platform: Pick<
    PlatformApi,
    'getProject' | 'getProjectMembership' | 'projectCompanies' | 'resolveLocations'
  >;
  documents: Pick<DocumentsApi, 'getDrawingRevision'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  /** The safety module's "stop work: SWMS not followed" (compliance 03 §4, r300). */
  safety: {
    reopenForReview(
      scope: TenantScope,
      projectId: string,
      swmsId: string,
      reason: string,
    ): Promise<void>;
    exists(scope: TenantScope, projectId: string, swmsId: string): Promise<boolean>;
  };
  now?: () => Date;
}

export async function checkFiles(
  deps: QualityDeps,
  scope: TenantScope,
  projectId: string,
  fileIds: readonly string[],
  path = 'fileIds',
): Promise<{ id: string; isImage: boolean }[]> {
  const out: { id: string; isImage: boolean }[] = [];
  for (const [i, fileId] of fileIds.entries()) {
    const f = await deps.files.getFile(scope, fileId);
    if (f.projectId !== projectId || f.status !== 'ready')
      throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
        { path: `${path}/${i}`, message: 'Not a ready file in this project' },
      ]);
    out.push({ id: fileId, isImage: f.mime.startsWith('image/') });
  }
  return out;
}

export async function viewerOf(deps: QualityDeps, scope: TenantScope, projectId: string) {
  const perms = await deps.access.effectivePermissions(scope, projectId);
  return {
    userId: scope.ctx.userId,
    companyId: perms.companyId,
    isInternal: scope.ctx.principalType === 'member',
  };
}

/** Checklists and inspections are the builder's; everyone else gets a plain not-found. */
export async function requireInternal(
  deps: QualityDeps,
  scope: TenantScope,
  projectId: string,
  code: 'inspection.not_found' | 'inspection_template.not_found',
) {
  const v = await viewerOf(deps, scope, projectId);
  if (!v.isInternal) throw new AppError(code);
  return v;
}

export const liveObservation = (id: string, projectId: string) =>
  and(
    eq(observations.id, id),
    eq(observations.projectId, projectId),
    isNull(observations.deletedAt),
  );

/**
 * A location picked from the project's tree: checks it is on the project and returns the path stored as the
 * record's readable `location` label.
 */
export async function locationLabel(
  deps: Pick<QualityDeps, 'platform'>,
  scope: TenantScope,
  projectId: string,
  locationId: string,
): Promise<string> {
  const found = await deps.platform.resolveLocations(scope, projectId, [locationId]);
  return found.get(locationId)!.path.slice(0, 200);
}
