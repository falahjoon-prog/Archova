// F5 defect photo tagging (ai/01 F5, product/06 DEF-US3): a photo of a defect, and the spot the site manager pinned
// on the drawing, become a suggested title, description, trade, kind of defect and priority, the companies on the
// project that could be assigned it, and any open defects already pinned nearby. Nothing is saved: the suggestion
// fills the defect form and the person saves it (Nova never raises a defect). The sheet text near the pin names the
// room, so the title can say where without the model guessing. Who to assign comes from the project's companies and
// their trades, not from the model.
import {
  defectTagPrompt,
  type DefectTagPin,
  type DefectTradeId,
  type SitePhoto,
} from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  DUPLICATE_RADIUS,
  duplicateCandidates,
  labelOfTrade,
  labelOfType,
  reviewDefectTag,
  suggestCompanies,
  type DuplicateCandidate,
  type NearbyDefect,
  type ProjectCompany,
  type ReviewedDefectTag,
  type SuggestedCompany,
} from '../domain/defect-tag';
import { markupContext } from '../domain/rfi-draft';
import type { DrawingRevisionRef } from './drawing-compare';
import { MAX_INLINE_BYTES, type ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { readSheetLines } from './sheet-text';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';

export interface DefectTagDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'ocr'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
  getRevision: (scope: TenantScope, projectId: string, id: string) => Promise<DrawingRevisionRef>;
  /** `platform.api.projectCompaniesWithTrades`: companies working on the project and the trades they list. */
  projectCompanies: (scope: TenantScope, projectId: string) => Promise<ProjectCompany[]>;
  /** `defects.api.openNear`: open defects the caller can see pinned within `radius` of the spot on the revision. */
  openDefectsNear: (
    scope: TenantScope,
    projectId: string,
    input: { drawingRevisionId: string; x: number; y: number; radius: number },
  ) => Promise<NearbyDefect[]>;
}

export interface DefectTagInput {
  /** What the person said or typed about the defect. */
  note: string;
  /** A photo already uploaded to this project (a `files` id). */
  photoFileId: string;
  /** The spot pinned on a drawing (normalised 0..1, origin top-left). */
  pin?: { drawingRevisionId: string; x: number; y: number };
}

export interface DefectTagSuggestion extends Omit<
  ReviewedDefectTag,
  'trade' | 'alternativeTrades' | 'defectType'
> {
  runId: string;
  /** Labels as a defect stores them, ready for the defect form; null when Nova couldn't settle one. */
  trade: string | null;
  alternativeTrades: string[];
  category: string | null;
  /** Companies on the project that list the trade (or an alternative); the person picks the assignee. */
  suggestedCompanies: SuggestedCompany[];
  /** Open defects already pinned beside this spot, nearest first. */
  duplicates: DuplicateCandidate[];
  /** The sheet the pin is on, with the text near it that the title may name. */
  drawing: {
    revisionId: string;
    sheetNumber: string;
    title: string;
    rev: string;
    pin: { x: number; y: number };
    nearby: string[];
    /** The sheet was read with OCR: the person should check the text against the drawing. */
    scanned: boolean;
  } | null;
}

export function createDefectTagService(deps: DefectTagDeps) {
  const { database } = deps;
  const ro = { readOnly: true, statementTimeout: '60s' } as const;

  async function tag(
    ctx: TenantContext,
    projectId: string,
    input: DefectTagInput,
    signal?: AbortSignal,
  ): Promise<DefectTagSuggestion> {
    const note = input.note.trim();
    const found = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'defects.defects.create', { projectId });
        const photoFile = await deps.readFile(scope, input.photoFileId, MAX_PHOTO_BYTES);
        const companies = await deps.projectCompanies(scope, projectId);
        if (!input.pin) return { photoFile, companies, pinned: null };
        await deps.assert(scope, 'documents.drawings.read', { projectId });
        const revision = await deps.getRevision(scope, projectId, input.pin.drawingRevisionId);
        const sheetFile = await deps.readFile(scope, revision.fileId, MAX_INLINE_BYTES);
        const near = await deps.openDefectsNear(scope, projectId, {
          drawingRevisionId: input.pin.drawingRevisionId,
          x: input.pin.x,
          y: input.pin.y,
          radius: DUPLICATE_RADIUS,
        });
        return { photoFile, companies, pinned: { revision, sheetFile, near } };
      },
      ro,
    );
    const photo: SitePhoto = toSitePhoto(found.photoFile, projectId);

    let drawing: DefectTagSuggestion['drawing'] = null;
    let pin: DefectTagPin | undefined;
    if (found.pinned && input.pin) {
      const { revision, sheetFile } = found.pinned;
      const sheet = await readSheetLines(
        deps.gateway,
        ctx,
        projectId,
        defectTagPrompt.feature,
        sheetFile,
        revision.pageIndex + 1,
      );
      const spot = { x: input.pin.x, y: input.pin.y };
      const nearby = markupContext([{ kind: 'pin', at: spot }], sheet.lines)?.nearby ?? [];
      pin = {
        sheet: `${revision.sheetNumber} ${revision.title}`.trim(),
        rev: revision.rev,
        nearby,
      };
      drawing = {
        revisionId: revision.id,
        sheetNumber: revision.sheetNumber,
        title: revision.title,
        rev: revision.rev,
        pin: spot,
        nearby,
        scanned: sheet.scanned,
      };
    }

    const run = await deps.gateway.runTask(
      ctx,
      defectTagPrompt,
      { note, photo, ...(pin ? { pin } : {}) },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this photo. Try again.");

    const reviewed = reviewDefectTag(run.output, {
      note,
      pinText: pin ? [pin.sheet, pin.rev, ...pin.nearby] : [],
    });
    const { trade, alternativeTrades, defectType, ...rest } = reviewed;
    const trades = [trade, ...alternativeTrades].filter((t): t is DefectTradeId => !!t);
    return {
      runId: run.runId,
      ...rest,
      trade: trade && labelOfTrade(trade),
      alternativeTrades: alternativeTrades.map(labelOfTrade),
      category: defectType && labelOfType(defectType),
      suggestedCompanies: suggestCompanies(found.companies, trades),
      duplicates:
        found.pinned && input.pin ? duplicateCandidates(input.pin, found.pinned.near, trade) : [],
      drawing,
    };
  }

  return { tag };
}

export type DefectTagService = ReturnType<typeof createDefectTagService>;
