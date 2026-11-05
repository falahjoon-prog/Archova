import { encodeId } from '@archova/domain';
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import { createAttendanceService, type ComplianceSource } from './application/attendance';
import { createInductionLinkService, type InductionLinkDeps } from './application/induction-links';
import { createEquipmentService } from './application/equipment';
import { createRosterService } from './application/roster';
import { createWalletService } from './application/wallet';
import { createWalletGrantService } from './application/wallet-grants';
import { createInductionService, type InductionDeps } from './application/inductions';
import { toSessionDto } from './api/mappers';
import { workforceRoutes, type InductionHooks } from './api/routes';
import { WORKFORCE_PERMISSIONS } from './permissions';

export function createWorkforceModule(
  services: KernelServices,
  deps: InductionDeps & {
    hooks?: InductionHooks;
    /** Access links (X45): what the link flow needs beyond the attendance and induction services. */
    links: Omit<InductionLinkDeps, 'database' | 'attendance' | 'inductions'>;
  },
) {
  // The induction rules join the X54 compliance interface ahead of any sources passed in.
  const sources: ComplianceSource[] = [...(deps.complianceSources ?? [])];
  const attendance = createAttendanceService({ ...deps, complianceSources: sources });
  const inductions = createInductionService(deps, attendance);
  sources.unshift(inductions.gateSource);
  const wallet = createWalletService({ files: deps.files });
  const grants = createWalletGrantService({
    access: deps.access,
    platform: deps.platform,
    files: deps.files,
  });
  const roster = createRosterService({
    access: deps.access,
    attendance,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const equipment = createEquipmentService({ access: deps.access });
  const links = createInductionLinkService({
    ...deps.links,
    database: services.database,
    attendance,
    inductions,
  });
  // Attendance sessions only. Workers are org-level records with personal details and have no project scope in
  // the change feed, so they stay on REST until their sync rule is decided.
  const syncSource: SyncSource = {
    module: 'workforce',
    permission: 'workforce.attendance.view',
    publicId: (_entityType, id) => encodeId('attendanceSession', id),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      if (!projectId || entityType !== 'attendance_session') return out;
      for (const s of await attendance.visibleSessions(scope, projectId, ids))
        out.set(s.id, {
          version: s.version,
          data: toSessionDto(s) as unknown as Record<string, unknown>,
        });
      return out;
    },
  };
  return {
    definition: defineModule({ name: 'workforce', permissions: WORKFORCE_PERMISSIONS }),
    routes: workforceRoutes(
      services.database,
      attendance,
      inductions,
      links,
      wallet,
      grants,
      roster,
      equipment,
      {
        logger: services.logger,
        ...deps.hooks,
      },
    ),
    api: {
      /** What the mobile pull reads (modules/sync): attendance sessions. */
      syncSource,
      /** Scheduled job (every 15 minutes per org): closes sessions left open after the site's day end. */
      closeOverdueSessions: attendance.closeOverdueSessions,
      /** For `ai` (ai/12 §3): a published version's slides and quiz (no answers), with internal ids. */
      getInductionVersion: inductions.versionForAi,
    },
  };
}

export type WorkforceModule = ReturnType<typeof createWorkforceModule>;
export type WorkforceApi = WorkforceModule['api'];
