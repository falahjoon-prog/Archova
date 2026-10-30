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
  /**
   * The sheet as the person's viewer drew it. The API image has no page renderer (a native canvas is approved for the
   * ai-worker image only), so the browser, which already renders the page, sends it. Without one the server renders
   * the page itself, where it can.
   */
  image?: { mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };
}

/** A sheet picture bigger than this is not a downscaled render. */
export const MAX_SHEET_IMAGE_BYTES = 8 * 1024 * 1024;
const MAGIC: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

/** The picture must be what it says it is and a sensible size: it goes to the model as it is. */
function checkImage(image: NonNullable<TakeoffDetectRequest['image']>) {
  const bytes = Buffer.from(image.base64, 'base64');
  const ok =
    bytes.length > 0 &&
    bytes.length <= MAX_SHEET_IMAGE_BYTES &&
    MAGIC[image.mime]!.every((b, i) => bytes[i] === b);
  if (!ok)
    throw new AppError('validation_failed', "That sheet picture can't be used.", [
      { path: 'image', message: 'Send a PNG, JPEG or WebP picture of the sheet under 8 MB' },
    ]);
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
    if (input.image) checkImage(input.image);
    const rasterize = deps.rasterizePage;
    if (!input.image && !rasterize)
      throw new AppError(
        'ai.takeoff.renderer_unavailable',
        'Nova takeoff is not available on this server yet.',
      );
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
        image: input.image ?? (await renderedImage(rasterize!, file, revision.pageIndex)),
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

async function renderedImage(
  rasterize: NonNullable<TakeoffDetectDeps['rasterizePage']>,
  file: ReadableFile,
  pageIndex: number,
) {
  const raster = await rasterize(file, pageIndex);
  return {
    mime: 'image/png' as const,
    base64: Buffer.from(encodePng(raster)).toString('base64'),
  };
}

export type TakeoffDetectService = ReturnType<typeof createTakeoffDetectService>;
