// F35 site photo hazard signals (ai/11): a photo already uploaded to the project is read for the visual hazard
// patterns a safety manager should look at (protective equipment that appears not to be worn, unprotected edges,
// untidy walkways). Every signal is an observation kept `open` for a manager to confirm or dismiss; Nova never says a
// rule was broken and never raises an incident. Confirmed signals make the project's patterns, the early warning
// before a near miss becomes an incident. The photo is read through the caller's own file access.
import { hazardScanPrompt, type HazardConfidence } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  HAZARD_DISCLAIMER,
  hazardPatterns,
  labelOfHazard,
  reviewHazardScan,
  type HazardPattern,
  type HazardSignalStatus,
} from '../domain/hazard-scan';
import { hazardSignals } from '../infra/tables';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';

export interface HazardScanDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  now?: () => Date;
}

export interface HazardSignalView {
  id: string;
  fileId: string;
  category: string;
  categoryLabel: string;
  observation: string;
  confidence: HazardConfidence;
  status: HazardSignalStatus;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface HazardScanResult {
  runId: string;
  scanId: string;
  signals: HazardSignalView[];
  photoUnclear: boolean;
  dropped: number;
  unsupportedNumbers: string[];
  disclaimer: string;
}

const view = (r: typeof hazardSignals.$inferSelect): HazardSignalView => ({
  id: r.id,
  fileId: r.fileId,
  category: r.category,
  categoryLabel: labelOfHazard(r.category),
  observation: r.observation,
  confidence: r.confidence,
  status: r.status,
  reviewNote: r.reviewNote,
  reviewedAt: r.reviewedAt,
  createdAt: r.createdAt,
});

export function createHazardScanService(deps: HazardScanDeps) {
  const { database } = deps;
  const now = deps.now ?? (() => new Date());
  const ro = { readOnly: true, statementTimeout: '60s' } as const;

  async function scan(
    ctx: TenantContext,
    projectId: string,
    input: { note: string; photoFileId: string },
    signal?: AbortSignal,
  ): Promise<HazardScanResult> {
    const note = input.note.trim();
    const file = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.safety.scan', { projectId });
        return deps.readFile(scope, input.photoFileId, MAX_PHOTO_BYTES);
      },
      ro,
    );
    const photo = toSitePhoto(file, projectId);
    const run = await deps.gateway.runTask(
      ctx,
      hazardScanPrompt,
      { note, photo },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this photo. Try again.");
    const reviewed = reviewHazardScan(run.output, { note });
    const scanId = uuidv7();
    const rows = await database.withTenantTx(ctx, async (scope) => {
      if (!reviewed.signals.length) return [];
      return scope.tx
        .insert(hazardSignals)
        .values(
          reviewed.signals.map((s) => ({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            scanId,
            fileId: input.photoFileId,
            runId: run.runId,
            promptVersion: hazardScanPrompt.version,
            category: s.category,
            observation: s.observation,
            confidence: s.confidence,
            status: 'open' as const,
            createdBy: scope.ctx.userId,
            updatedBy: scope.ctx.userId,
          })),
        )
        .returning();
    });
    return {
      runId: run.runId,
      scanId,
      signals: rows.map(view),
      photoUnclear: reviewed.photoUnclear,
      dropped: reviewed.dropped,
      unsupportedNumbers: reviewed.unsupportedNumbers,
      disclaimer: HAZARD_DISCLAIMER,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: HazardSignalStatus; limit: number },
  ): Promise<HazardSignalView[]> {
    await deps.assert(scope, 'ai.safety.review', { projectId });
    const rows = await scope.tx
      .select()
      .from(hazardSignals)
      .where(
        and(
          eq(hazardSignals.projectId, projectId),
          opts.status ? eq(hazardSignals.status, opts.status) : undefined,
        ),
      )
      .orderBy(desc(hazardSignals.createdAt), desc(hazardSignals.id))
      .limit(opts.limit);
    return rows.map(view);
  }

  async function review(
    scope: TenantScope,
    projectId: string,
    signalId: string,
    input: { decision: 'confirmed' | 'dismissed'; note?: string },
  ): Promise<HazardSignalView> {
    await deps.assert(scope, 'ai.safety.review', { projectId });
    const [row] = await scope.tx
      .select()
      .from(hazardSignals)
      .where(and(eq(hazardSignals.id, signalId), eq(hazardSignals.projectId, projectId)))
      .for('update');
    if (!row) throw new AppError('ai.hazard_signal.not_found');
    if (row.status !== 'open') throw new AppError('ai.hazard_signal.already_reviewed');
    const [updated] = await scope.tx
      .update(hazardSignals)
      .set({
        status: input.decision,
        reviewNote: input.note?.trim() || null,
        reviewedBy: scope.ctx.userId,
        reviewedAt: now(),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: row.version + 1,
      })
      .where(eq(hazardSignals.id, signalId))
      .returning();
    return view(updated!);
  }

  async function patterns(
    scope: TenantScope,
    projectId: string,
    days: number,
  ): Promise<HazardPattern[]> {
    await deps.assert(scope, 'ai.safety.review', { projectId });
    const at = now();
    const rows = await scope.tx
      .select({
        category: hazardSignals.category,
        status: hazardSignals.status,
        photoId: hazardSignals.fileId,
        createdAt: hazardSignals.createdAt,
      })
      .from(hazardSignals)
      .where(
        and(
          eq(hazardSignals.projectId, projectId),
          gte(hazardSignals.createdAt, new Date(at.getTime() - days * 86_400_000)),
        ),
      );
    return hazardPatterns(rows, { now: at, days });
  }

  return { scan, list, review, patterns };
}

export type HazardScanService = ReturnType<typeof createHazardScanService>;
