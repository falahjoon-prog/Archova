import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';

/** Other modules' public interfaces `documents` uses (no cross-module SQL). */
export interface DocumentsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  files: Pick<FilesModule['api'], 'getFile'>;
}

export function createContext(deps: DocumentsDeps) {
  /** 404 for a project that doesn't exist or was deleted (org admins pass the permission check without membership). */
  async function requireProject(scope: TenantScope, projectId: string) {
    return deps.platform.getProject(scope, projectId);
  }

  /** A file a record points at must be in the same project and clean (backend 06 §5). */
  async function requireReadyFile(scope: TenantScope, projectId: string, fileId: string) {
    const f = await deps.files.getFile(scope, fileId);
    if (f.projectId !== projectId)
      throw new AppError('file.not_in_project', 'That file belongs to another project.', [
        { path: 'fileId', message: 'File is not in this project' },
      ]);
    if (f.status !== 'ready')
      throw new AppError('file.not_ready', 'That file is still being checked or was blocked.');
    return f;
  }

  async function viewer(scope: TenantScope, projectId: string) {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return { userId: scope.ctx.userId, companyId: perms.companyId };
  }

  return { requireProject, requireReadyFile, viewer, access: deps.access };
}

export type DocumentsContext = ReturnType<typeof createContext>;
