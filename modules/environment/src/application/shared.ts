import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';

export interface EnvironmentDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

/** Evidence and documents must be ready files uploaded to this project. */
export async function checkFiles(
  deps: EnvironmentDeps,
  scope: TenantScope,
  projectId: string,
  fileIds: readonly string[],
  path = 'fileIds',
) {
  for (const [i, fileId] of fileIds.entries()) {
    const f = await deps.files.getFile(scope, fileId);
    if (f.projectId !== projectId || f.status !== 'ready')
      throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
        { path: `${path}/${i}`, message: 'Not a ready file in this project' },
      ]);
  }
}

/** Today's date at the project, so "overdue" follows the site's calendar, not the server's (X34). */
export async function projectToday(deps: EnvironmentDeps, scope: TenantScope, projectId: string) {
  const project = await deps.platform.getProject(scope, projectId);
  return localDateOf((deps.now ?? (() => new Date()))(), project.timezone);
}

export function uniqueViolation(e: unknown): string | null {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  if (err.code === '23505') return err.constraint ?? '';
  if (err.cause?.code === '23505') return err.cause.constraint ?? '';
  return null;
}
