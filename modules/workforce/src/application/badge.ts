import { and, eq, inArray } from 'drizzle-orm';
import { AppError, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import {
  inductionCompletions,
  inductions,
  workerCredentials,
  workers,
  type EmergencyContact,
} from '../infra/tables';
import { workerChanged, type AttendanceService } from './attendance';
import type { InductionDeps } from './inductions';

// The worker's own digital Safety ID badge (like a site pass on their phone): who they are, who to call, and
// what they are cleared for on this project. Everything here is the worker's own record, read through
// `workforce.attendance.sign_in_self`; no one else's data is reachable from these calls.

export interface BadgeCredential {
  kind: string;
  numberLast4: string;
  expiresOn: string | null;
  status: 'recorded' | 'sighted';
}

export interface BadgeInduction {
  title: string;
  completedAt: Date;
  expiresOn: string | null;
}

export interface BadgeView {
  worker: typeof workers.$inferSelect;
  companyName: string | null;
  photo: { url: string; expiresAt: Date } | null;
  credentials: BadgeCredential[];
  inductions: BadgeInduction[];
}

export interface BadgeDeps {
  attendance: Pick<AttendanceService, 'selfWorker'>;
  platform: Pick<PlatformApi, 'projectCompanies'>;
  files: InductionDeps['files'];
}

export function createBadgeService(deps: BadgeDeps) {
  async function view(scope: TenantScope, projectId: string): Promise<BadgeView> {
    const worker = await deps.attendance.selfWorker(scope, projectId);
    const [creds, completions, companies] = await Promise.all([
      scope.tx.select().from(workerCredentials).where(eq(workerCredentials.workerId, worker.id)),
      scope.tx
        .select({
          title: inductions.title,
          completedAt: inductionCompletions.completedAt,
          expiresOn: inductionCompletions.expiresOn,
        })
        .from(inductionCompletions)
        .innerJoin(inductions, eq(inductions.id, inductionCompletions.inductionId))
        .where(
          and(
            eq(inductionCompletions.workerId, worker.id),
            eq(inductionCompletions.projectId, projectId),
            eq(inductionCompletions.status, 'completed'),
          ),
        ),
      worker.companyId
        ? deps.platform.projectCompanies(scope, projectId)
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const photo = worker.photoFileId
      ? await deps.files
          .downloadUrl(scope, worker.photoFileId, { authorised: true, expiresInS: 900 })
          .catch(() => null)
      : null;
    return {
      worker,
      companyName:
        companies.find((c) => c.id === worker.companyId)?.name ?? worker.companyNameOther ?? null,
      photo,
      credentials: creds
        .map((c) => ({
          kind: c.kind,
          numberLast4: c.numberLast4,
          expiresOn: c.expiresOn,
          status: c.status,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
      inductions: completions
        .filter((c): c is typeof c & { completedAt: Date } => c.completedAt !== null)
        .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()),
    };
  }

  async function patchWorker(
    scope: TenantScope,
    projectId: string,
    values: Partial<Pick<typeof workers.$inferInsert, 'emergencyContact' | 'photoFileId'>>,
  ) {
    const w = await deps.attendance.selfWorker(scope, projectId);
    const [row] = await scope.tx
      .update(workers)
      .set({
        ...values,
        version: w.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(workers.id, w.id), inArray(workers.status, ['active', 'inactive'])))
      .returning();
    await workerChanged(scope, row!);
  }

  async function setEmergencyContact(
    scope: TenantScope,
    projectId: string,
    input: { name: string; relationship?: string | null; phone: string } | null,
  ) {
    let contact: EmergencyContact | null = null;
    if (input) {
      const name = input.name.trim();
      const phone = input.phone.replace(/[^\d+]/g, '');
      if (!name)
        throw new AppError('validation_failed', 'Enter the contact’s name.', [
          { path: 'name', message: 'Required' },
        ]);
      if (!/^\+?\d{8,15}$/.test(phone))
        throw new AppError('validation_failed', 'Enter a phone number with 8 to 15 digits.', [
          { path: 'phone', message: 'Not a phone number' },
        ]);
      contact = { name, relationship: input.relationship?.trim() || null, phone };
    }
    await patchWorker(scope, projectId, { emergencyContact: contact });
    return view(scope, projectId);
  }

  /** The photo must be a scanned file the worker uploaded themselves. */
  async function setPhoto(scope: TenantScope, projectId: string, fileId: string | null) {
    if (fileId) {
      const f = await deps.files.getFile(scope, fileId).catch(() => null);
      if (!f || f.status !== 'ready' || f.createdBy !== scope.ctx.userId)
        throw new AppError('validation_failed', 'Upload your photo first.', [
          { path: 'fileId', message: 'Not a ready upload of yours' },
        ]);
    }
    await patchWorker(scope, projectId, { photoFileId: fileId });
    return view(scope, projectId);
  }

  return { view, setEmergencyContact, setPhoto };
}

export type BadgeService = ReturnType<typeof createBadgeService>;
