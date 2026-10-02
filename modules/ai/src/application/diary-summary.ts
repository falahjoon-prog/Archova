// F4 site diary summary (ai/01 F4, product/05 DIA-US7): "write today's summary" drafts a short daily report from
// the day's diary lines. The draft is a pending suggestion the site manager edits into the day's notes; `ai`
// never writes diary tables. Cached per entry version, so pressing the button again costs nothing until the
// diary changes.
import { and, desc, eq, sql } from 'drizzle-orm';
import { diarySummaryPrompt } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext } from '@archova/kernel';
import {
  diaryFacts,
  reviewDiarySummary,
  weekdayOf,
  type DiaryDayForSummary,
  type ReviewedSummary,
} from '../domain/diary-summary';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';

export const DIARY_SUMMARY_TASK = diarySummaryPrompt.id;
export const DIARY_ENTRY_TARGET = 'diary_entry';

/** `ai_suggestions.payload` for `diary.summary`. */
export interface DiarySummaryPayload extends ReviewedSummary {
  date: string;
  /** The diary entry version this summary was written from. */
  entryVersion: number;
}

export interface DiarySummaryDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
}

export function createDiarySummaryService(deps: DiarySummaryDeps) {
  const { database } = deps;

  /**
   * The caller has already passed the diary read check: `day` comes from `diary.api.dayForSummary`, which returns
   * only the lines they may see.
   */
  async function summariseDay(ctx: TenantContext, projectId: string, day: DiaryDayForSummary) {
    const cached = await database.withTenantTx(
      ctx,
      async (scope) => {
        const [row] = await scope.tx
          .select()
          .from(suggestions)
          .where(
            and(
              eq(suggestions.orgId, scope.ctx.orgId),
              eq(suggestions.projectId, projectId),
              eq(suggestions.task, DIARY_SUMMARY_TASK),
              eq(suggestions.targetType, DIARY_ENTRY_TARGET),
              eq(suggestions.targetId, day.entryId),
              eq(suggestions.promptVersion, diarySummaryPrompt.version),
              eq(suggestions.status, 'pending'),
              sql`(${suggestions.payload}->>'entryVersion')::int = ${day.version}`,
            ),
          )
          .orderBy(desc(suggestions.createdAt))
          .limit(1);
        return row ?? null;
      },
      { readOnly: true },
    );
    if (cached) return cached;

    const built = diaryFacts(day);
    if (!built.facts.length)
      throw new AppError(
        'ai.diary.nothing_to_summarise',
        "There's nothing in this day's diary yet. Add labour, notes or delays, then ask Nova again.",
      );
    const run = await deps.gateway.runTask(
      ctx,
      diarySummaryPrompt,
      { date: day.date, weekday: weekdayOf(day.date), facts: built.facts },
      { projectId },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't write this summary. Try again.");

    const reviewed = reviewDiarySummary(run.output, built, day);
    const payload: DiarySummaryPayload = { date: day.date, entryVersion: day.version, ...reviewed };
    const total = reviewed.sentences.length + reviewed.dropped;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: DIARY_ENTRY_TARGET,
          targetId: day.entryId,
          task: DIARY_SUMMARY_TASK,
          promptVersion: diarySummaryPrompt.version,
          payload,
          // Share of the model's sentences that passed the checks.
          confidence: total ? reviewed.sentences.length / total : 0,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  return { summariseDay };
}

export type DiarySummaryService = ReturnType<typeof createDiarySummaryService>;
