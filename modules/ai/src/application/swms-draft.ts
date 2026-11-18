// F20 SWMS assistant, drafting (compliance/08 §3). The person gives the minimum inputs (site, activity, high-risk
// work codes, work area, access, plant, adjacent trades); Nova searches the project documents they can open for the
// site's own rules, drafts the SWMS once, and the checks in domain/swms-draft.ts run before anything is stored. The
// draft is a creator-only pending suggestion: a competent person edits it and submits it to the SWMS register
// (`safety` owns that; ai never writes safety tables). Off unless `API_AI_SWMS_DRAFTS` is on, until Grace and the WHS
// lawyer clear it for pilots (compliance/08 §9).
import {
  SWMS_HRCW,
  swmsDraftPrompt,
  type PromptPassage,
  type SwmsDraftInput,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  SWMS_DRAFT_NOTICE,
  reviewSwmsDraft,
  toSwmsContent,
  type SwmsDraftWarning,
} from '../domain/swms-draft';
import { suggestions } from '../infra/tables';
import type { DraftCitation } from './induction-draft';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';

export interface SwmsDraftDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
  /** `API_AI_SWMS_DRAFTS`: false until the feature is cleared for pilots. */
  enabled: boolean;
}

export const SWMS_DRAFT_TASK = 'swms.draft';
/** Passages searched for the site's own rules and plan. */
const PASSAGES = 6;

/** `ai_suggestions.payload` for `swms.draft`. */
export interface SwmsDraftPayload {
  siteAddress: string;
  activity: string;
  highRiskWorkCategories: string[];
  /** Shaped like the safety module's SWMS content, for the person to edit and submit. */
  content: ReturnType<typeof toSwmsContent>;
  hazards: Array<{ category: string; hazard: string; risk: string }>;
  controls: Array<{ category: string; level: string; description: string }>;
  gaps: string[];
  references: DraftCitation[];
  warnings: SwmsDraftWarning[];
  /** Fixed wording, never the model's (compliance/08 §1.2). */
  notice: string;
}

export function createSwmsDraftService(deps: SwmsDraftDeps) {
  const { database } = deps;
  const ro = { readOnly: true } as const;

  async function draft(
    ctx: TenantContext,
    projectId: string,
    raw: SwmsDraftInput,
    signal?: AbortSignal,
  ) {
    if (!deps.enabled)
      throw new AppError(
        'ai.swms.not_enabled',
        'SWMS drafting by Nova is not switched on yet. Write the SWMS in the register.',
      );
    const clean = (s: string) => s.trim();
    const input: SwmsDraftInput = {
      siteAddress: clean(raw.siteAddress),
      activity: clean(raw.activity),
      highRiskWorkCategories: [...new Set(raw.highRiskWorkCategories)],
      workArea: clean(raw.workArea),
      access: clean(raw.access),
      plant: raw.plant.map(clean).filter(Boolean),
      adjacentTrades: raw.adjacentTrades.map(clean).filter(Boolean),
      ...(raw.whsPlanApplies !== undefined ? { whsPlanApplies: raw.whsPlanApplies } : {}),
      ...(raw.notes?.trim() ? { notes: raw.notes.trim() } : {}),
    };
    // Nova won't draft from an activity name alone (compliance/08 §3).
    const missing = (
      [
        ['siteAddress', input.siteAddress],
        ['activity', input.activity],
        ['workArea', input.workArea],
        ['access', input.access],
      ] as const
    ).filter(([, v]) => !v);
    if (missing.length || input.highRiskWorkCategories.length === 0)
      throw new AppError(
        'validation_failed',
        'Nova needs the site, the activity, the high-risk work, the work area and the access before it drafts a SWMS.',
        [
          ...missing.map(([path]) => ({ path, message: 'Required.' })),
          ...(input.highRiskWorkCategories.length === 0
            ? [{ path: 'highRiskWorkCategories', message: 'Choose the high-risk work.' }]
            : []),
        ],
      );

    const scopes = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'safety.swms.submit', { projectId });
        return deps.accessScopes(scope, projectId);
      },
      ro,
    );

    let rows: ChunkHit[] = [];
    if (scopes.length) {
      const query = [
        'safe work method statement WHS management plan site rules',
        input.activity,
        input.workArea,
        input.access,
        ...input.highRiskWorkCategories.map((c) => SWMS_HRCW[c]),
      ].join('\n');
      const { vectors } = await deps.gateway.embed(ctx, [query], {
        purpose: 'query',
        feature: swmsDraftPrompt.feature,
        projectId,
      });
      rows = await database.withTenantTx(
        ctx,
        (scope) =>
          searchChunks(scope, { projectId, scopes, query, vector: vectors[0]!, limit: PASSAGES }),
        ro,
      );
    }
    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));

    const run = await deps.gateway.runTask(ctx, swmsDraftPrompt, input, {
      projectId,
      passages,
      ...(signal ? { signal } : {}),
    });
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft this SWMS. Try again.");

    const reviewed = reviewSwmsDraft(run.output, {
      inputText: [
        input.siteAddress,
        input.activity,
        input.workArea,
        input.access,
        ...input.plant,
        ...input.adjacentTrades,
        input.notes ?? '',
      ].join('\n'),
      categories: input.highRiskWorkCategories,
      passageText: new Map(passages.map((p) => [p.id, `${p.source.title}\n${p.text}`])),
      citations: run.citations,
    });
    const payload: SwmsDraftPayload = {
      siteAddress: input.siteAddress,
      activity: input.activity,
      highRiskWorkCategories: reviewed.highRiskWorkCategories,
      content: toSwmsContent(reviewed, SWMS_HRCW, input.whsPlanApplies ?? false),
      hazards: reviewed.hazards,
      controls: reviewed.controls,
      gaps: reviewed.gaps,
      references: reviewed.references.map((c) => ({
        quote: c.quote,
        sourceType: c.source.type,
        sourceId: c.source.id,
        revisionId: c.source.revisionId ?? null,
        page: c.source.page ?? null,
        title: c.source.title,
      })),
      warnings: reviewed.warnings,
      notice: SWMS_DRAFT_NOTICE,
    };
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'project',
          targetId: projectId,
          task: SWMS_DRAFT_TASK,
          promptVersion: swmsDraftPrompt.version,
          payload,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  return { draft };
}

export type SwmsDraftService = ReturnType<typeof createSwmsDraftService>;
