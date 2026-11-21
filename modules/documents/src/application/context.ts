import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { assertFileReady, type FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';

/** Other modules' public interfaces `documents` uses (no cross-module SQL). */
export interface DocumentsDeps {
  access: AccessService;
  platform: Pick<
    PlatformApi,
    'getProject' | 'getOrg' | 'resolveTenantAccess' | 'getProjectMembership' | 'projectCompanies'
  >;
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
    assertFileReady(f);
    return f;
  }

  async function viewer(scope: TenantScope, projectId: string) {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return { userId: scope.ctx.userId, companyId: perms.companyId };
  }

  /** People named in a request must be on this project (so a review can't be assigned to an outsider). */
  async function requireMembers(
    scope: TenantScope,
    projectId: string,
    userIds: readonly string[],
    path: string,
  ) {
    for (const [i, userId] of userIds.entries()) {
      if (!(await deps.platform.getProjectMembership(scope, projectId, userId)))
        throw new AppError('validation_failed', 'Choose people who are on this project.', [
          {
            path: userIds.length > 1 ? `${path}/${i}` : path,
            message: 'Not a member of the project',
          },
        ]);
    }
  }

  async function requireCompany(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Choose a company on this project.', [
        { path: 'responsibleCompanyId', message: 'Not a company on the project' },
      ]);
  }

  return {
    requireProject,
    requireMembers,
    requireCompany,
    requireReadyFile,
    viewer,
    access: deps.access,
  };
}

export type DocumentsContext = ReturnType<typeof createContext>;
