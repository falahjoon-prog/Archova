// Nova Esti assisted takeoff (ai/10 E1, X30): "count all of these" / "outline these" on one drawing sheet. Nova finds
// the items and says how sure it is; code checks the shapes (`domain/takeoff-detect`). Nothing is saved here and
// nothing is measured: the estimating module saves the items as unconfirmed `assisted` measurements, sizes them from
// the sheet's confirmed scale, and only a person's accept makes a quantity count. Trade-agnostic by design.
import { takeoffDetectPrompt, type TakeoffTargetKind } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { readSheetLines } from './sheet-text';
import { reviewDetection, type ReviewedDetection } from '../domain/takeoff-detect';
import type { Raster } from '../domain/visual-diff';
import { encodePng } from '../infra/raster';
import { MAX_INLINE_BYTES, type ReadableFile } from './drawing-register';
import type { DrawingRevisionRef } from './drawing-compare';
import type { Gateway } from './gateway';

export const TAKEOFF_DETECT_TASK = takeoffDetectPrompt.id;
/** Asking Nova to find items is part of making measurements. */
export const TAKEOFF_DETECT_PERMISSION = 'estimating.takeoff.manage';

export interface TakeoffDetectDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  getRevision: (scope: TenantScope, projectId: string, id: string) => Promise<DrawingRevisionRef>;
  /** Renders one PDF page as greyscale. Unset where no renderer is installed: the run answers 503. */
  rasterizePage?: (file: ReadableFile, pageIndex: number) => Promise<Raster>;
}

export interface TakeoffDetectRequest {
  revisionId: string;
  target: { kind: TakeoffTargetKind; what: string; hint?: string };
  examples?: Array<{ x: number; y: number }>;
}

export interface TakeoffDetection extends ReviewedDetection {
  runId: string;
  revisionId: string;
  kind: TakeoffTargetKind;
  what: string;
  /** The model's confidence is capped: the sheet is a scan, every item needs a person's eye. */
  scanned: boolean;
}

export function createTakeoffDetectService(deps: TakeoffDetectDeps) {
  async function detect(
    ctx: TenantContext,
    projectId: string,
    input: TakeoffDetectRequest,
    signal?: AbortSignal,
  ): Promise<TakeoffDetection> {
    if (!deps.rasterizePage)
      throw new AppError(
        'ai.takeoff.renderer_unavailable',
        'Nova takeoff is not available on this server yet.',
      );
    const rasterize = deps.rasterizePage;
    const { revision, file } = await deps.database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, TAKEOFF_DETECT_PERMISSION, { projectId });
        const revision = await deps.getRevision(scope, projectId, input.revisionId);
        if (revision.status === 'draft') throw new AppError('drawing_revision.not_found');
        const file = await deps.readFile(scope, revision.fileId, MAX_INLINE_BYTES);
        return { revision, file };
      },
      { readOnly: true },
    );

    const raster = await rasterize(file, revision.pageIndex);
    // The sheet's own words (legend, room names) help match symbols; a page with no text layer is a scan (ai/10 §2).
    const sheet = await readSheetLines(
      deps.gateway,
      ctx,
      projectId,
      'takeoff',
      file,
      revision.pageIndex + 1,
    );
    const run = await deps.gateway.runTask(
      ctx,
      takeoffDetectPrompt,
      {
        sheetLabel: `${revision.sheetNumber} ${revision.title}`.slice(0, 300),
        target: {
          kind: input.target.kind,
          what: input.target.what.trim().slice(0, 120),
          ...(input.target.hint ? { hint: input.target.hint.slice(0, 400) } : {}),
        },
        examples: (input.examples ?? []).slice(0, 5),
        legendText: sheet.lines
          .map((l) => l.text)
          .join('\n')
          .slice(0, 4000),
        image: { mime: 'image/png', base64: Buffer.from(encodePng(raster)).toString('base64') },
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this sheet. Try again.");

    // Vector CAD output always carries text; a sheet with none, or that is not a PDF, is read as a scan.
    const scanned = sheet.scanned || !sheet.lines.length || file.file.mime !== 'application/pdf';
    return {
      ...reviewDetection(run.output, input.target.kind, { scanned }),
      runId: run.runId,
      revisionId: input.revisionId,
      kind: input.target.kind,
      what: input.target.what.trim(),
      scanned,
    };
  }

  return { detect };
}

export type TakeoffDetectService = ReturnType<typeof createTakeoffDetectService>;
