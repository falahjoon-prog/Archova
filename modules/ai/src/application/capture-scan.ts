// Site Capture "Ask Nova about this view": a still from a 360 tour, uploaded to the project, is read for what looks
// like a defect, missing fire-stopping or incomplete work. Every observation is kept `open` for a person to confirm or
// dismiss; Nova never says a rule was broken and never raises an issue. It reads the still, not the live embed.
import { captureScanPrompt, type CaptureConfidence } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { and, desc, eq } from 'drizzle-orm';
import {
  CAPTURE_DISCLAIMER,
  labelOfCapture,
  reviewCaptureScan,
  type CaptureObservationStatus,
} from '../domain/capture-scan';
import { captureObservations } from '../infra/tables';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';

export interface CaptureScanDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  now?: () => Date;
}

export interface CaptureObservationView {
  id: string;
  fileId: string;
  category: string;
  categoryLabel: string;
  observation: string;
  confidence: CaptureConfidence;
  status: CaptureObservationStatus;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface CaptureScanResult {
  runId: string;
  scanId: string;
  observations: CaptureObservationView[];
  stillUnclear: boolean;
  dropped: number;
  unsupportedNumbers: string[];
  disclaimer: string;
}

const view = (r: typeof captureObservations.$inferSelect): CaptureObservationView => ({
  id: r.id,
  fileId: r.fileId,
  category: r.category,
  categoryLabel: labelOfCapture(r.category),
  observation: r.observation,
  confidence: r.confidence,
  status: r.status,
  reviewNote: r.reviewNote,
  reviewedAt: r.reviewedAt,
  createdAt: r.createdAt,
});

export function createCaptureScanService(deps: CaptureScanDeps) {
  const { database } = deps;
  const now = deps.now ?? (() => new Date());
  const ro = { readOnly: true, statementTimeout: '60s' } as const;

  async function scan(
    ctx: TenantContext,
    projectId: string,
    input: { note: string; stillFileId: string },
    signal?: AbortSignal,
  ): Promise<CaptureScanResult> {
    const note = input.note.trim();
    const file = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.captures.scan', { projectId });
        return deps.readFile(scope, input.stillFileId, MAX_PHOTO_BYTES);
      },
      ro,
    );
    const photo = toSitePhoto(file, projectId);
    const run = await deps.gateway.runTask(
      ctx,
      captureScanPrompt,
      { note, photo },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this view. Try again.");
    const reviewed = reviewCaptureScan(run.output, { note });
    const scanId = uuidv7();
    const rows = await database.withTenantTx(ctx, async (scope) => {
      if (!reviewed.observations.length) return [];
      const inserted = await scope.tx
        .insert(captureObservations)
        .values(
          reviewed.observations.map((o) => ({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            scanId,
            fileId: input.stillFileId,
            runId: run.runId,
            promptVersion: captureScanPrompt.version,
            category: o.category,
            observation: o.observation,
            confidence: o.confidence,
            status: 'open' as const,
            createdBy: scope.ctx.userId,
            updatedBy: scope.ctx.userId,
          })),
        )
        .returning();
      // Audit: ids and counts only, never the observation text.
      scope.events.add({
        type: 'ai.capture_scan.created.v1',
        entityType: 'capture_scan',
        entityId: scanId,
        entityVersion: 1,
        data: {
          fileId: input.stillFileId,
          observations: inserted.length,
          actorId: scope.ctx.userId,
        },
      });
      return inserted;
    });
    return {
      runId: run.runId,
      scanId,
      observations: rows.map(view),
      stillUnclear: reviewed.stillUnclear,
      dropped: reviewed.dropped,
      unsupportedNumbers: reviewed.unsupportedNumbers,
      disclaimer: CAPTURE_DISCLAIMER,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: CaptureObservationStatus; fileId?: string; limit: number },
  ): Promise<CaptureObservationView[]> {
    await deps.assert(scope, 'ai.captures.review', { projectId });
    const rows = await scope.tx
      .select()
      .from(captureObservations)
      .where(
        and(
          eq(captureObservations.projectId, projectId),
          opts.status ? eq(captureObservations.status, opts.status) : undefined,
          opts.fileId ? eq(captureObservations.fileId, opts.fileId) : undefined,
        ),
      )
      .orderBy(desc(captureObservations.createdAt), desc(captureObservations.id))
      .limit(opts.limit);
    return rows.map(view);
  }

  async function review(
    scope: TenantScope,
    projectId: string,
    observationId: string,
    input: { decision: 'confirmed' | 'dismissed'; note?: string },
  ): Promise<CaptureObservationView> {
    await deps.assert(scope, 'ai.captures.review', { projectId });
    const [row] = await scope.tx
      .select()
      .from(captureObservations)
      .where(
        and(
          eq(captureObservations.id, observationId),
          eq(captureObservations.projectId, projectId),
        ),
      )
      .for('update');
    if (!row) throw new AppError('ai.capture_observation.not_found');
    if (row.status !== 'open') throw new AppError('ai.capture_observation.already_reviewed');
    const [updated] = await scope.tx
      .update(captureObservations)
      .set({
        status: input.decision,
        reviewNote: input.note?.trim() || null,
        reviewedBy: scope.ctx.userId,
        reviewedAt: now(),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: row.version + 1,
      })
      .where(eq(captureObservations.id, observationId))
      .returning();
    // Audit: who decided what on which observation, never the observation or the note.
    scope.events.add({
      type: 'ai.capture_observation.reviewed.v1',
      entityType: 'capture_observation',
      entityId: observationId,
      entityVersion: updated!.version,
      data: {
        decision: input.decision,
        category: row.category,
        fileId: row.fileId,
        actorId: scope.ctx.userId,
      },
    });
    return view(updated!);
  }

  return { scan, list, review };
}

export type CaptureScanService = ReturnType<typeof createCaptureScanService>;
