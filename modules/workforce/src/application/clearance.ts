import { and, asc, eq } from 'drizzle-orm';
import { decodeId, encodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import { workerCredentials, type workers } from '../infra/tables';
import { evaluateClearance, type ClearanceOutcome, type ClearanceSwms } from '../domain/clearance';
import type { AttendanceService, ComplianceSource } from './attendance';
import type { InductionDeps } from './inductions';

export interface ClearanceDeps {
  attendance: Pick<AttendanceService, 'viewer' | 'getWorker' | 'listSites'>;
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  files: InductionDeps['files'];
  /** The X54 induction and white card rule. */
  inductionSource: ComplianceSource;
  /** SWMS the worker's company works under on the project, from `safety`. Absent: the SWMS check is skipped. */
  swms?: (
    scope: TenantScope,
    projectId: string,
    worker: { companyId: string | null; userId: string | null },
  ) => Promise<ClearanceSwms[]>;
  now?: () => Date;
}

export interface WorkerClearance extends ClearanceOutcome {
  worker: typeof workers.$inferSelect;
  companyName: string | null;
  photo: { url: string; expiresAt: Date } | null;
  siteId: string | null;
  localDate: string;
  checkedAt: Date;
}

const BADGE_PREFIX = 'archova:badge:';

/** The text a Safety ID badge QR encodes, or a bare worker id, to the worker's row id. */
export function workerIdFromCode(code: string): string {
  const raw = code.trim();
  const publicId = raw.startsWith(BADGE_PREFIX) ? raw.slice(BADGE_PREFIX.length) : raw;
  const id = decodeId('worker', publicId);
  if (!id)
    throw new AppError('validation_failed', 'That is not an Archova Safety ID code.', [
      { path: 'code', message: 'Not a badge code' },
    ]);
  return id;
}

export const badgeCodeFor = (workerId: string) => `${BADGE_PREFIX}${encodeId('worker', workerId)}`;

/**
 * "Is this person cleared to be on site today?" Reads, never writes: it gathers the facts the badge, wallet,
 * induction and SWMS modules already hold and applies the clearance rules. The caller has
 * `workforce.attendance.view`; a subcontractor's supervisor only reaches their own company's workers.
 */
export function createClearanceService(deps: ClearanceDeps) {
  const now = deps.now ?? (() => new Date());

  async function check(
    scope: TenantScope,
    projectId: string,
    input: { code: string; siteId?: string },
  ): Promise<WorkerClearance> {
    const viewer = await deps.attendance.viewer(scope, projectId);
    const worker = await deps.attendance.getWorker(scope, workerIdFromCode(input.code), viewer);
    const project = await deps.platform.getProject(scope, projectId);
    const checkedAt = now();
    const localDate = localDateOf(checkedAt, project.timezone);
    const sites = await deps.attendance.listSites(scope, projectId);
    const site = input.siteId
      ? sites.find((s) => s.site.id === input.siteId)
      : (sites.find((s) => s.site.active !== false) ?? sites[0]);
    if (input.siteId && !site) throw new AppError('workforce_site.not_found');

    const [creds, companies, inductionResult, swms] = await Promise.all([
      scope.tx
        .select()
        .from(workerCredentials)
        .where(and(eq(workerCredentials.workerId, worker.id)))
        .orderBy(asc(workerCredentials.createdAt), asc(workerCredentials.id)),
      worker.companyId
        ? deps.platform.projectCompanies(scope, projectId)
        : Promise.resolve([] as { id: string; name: string }[]),
      site && worker.kind === 'worker'
        ? deps.inductionSource(scope, { worker, projectId, siteId: site.site.id, localDate })
        : Promise.resolve(null),
      worker.kind === 'worker' && deps.swms
        ? deps.swms(scope, projectId, { companyId: worker.companyId, userId: worker.userId })
        : Promise.resolve([] as ClearanceSwms[]),
    ]);
    const photo = worker.photoFileId
      ? await deps.files
          .downloadUrl(scope, worker.photoFileId, { authorised: true, expiresInS: 300 })
          .catch(() => null)
      : null;

    const outcome = evaluateClearance({
      today: localDate,
      workerActive: worker.status === 'active',
      credentials: creds.map((c) => ({ kind: c.kind, expiresOn: c.expiresOn })),
      inductionReasons: inductionResult ? inductionResult.reasons : null,
      swms,
    });
    return {
      ...outcome,
      worker,
      companyName:
        companies.find((c) => c.id === worker.companyId)?.name ?? worker.companyNameOther ?? null,
      photo,
      siteId: site?.site.id ?? null,
      localDate,
      checkedAt,
    };
  }

  return { check };
}

export type ClearanceService = ReturnType<typeof createClearanceService>;
