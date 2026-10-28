// F4 weekly diary summary (ai/01 F4, product/05 DIA-US7): "write this week's summary" drafts a short report for the
// client or head office from the week's diary days. Like the daily summary it is a pending suggestion that `ai`
// never writes into the diary, cached per person and week content, and private to the person who asked: what it says
// depends on the lines they may read (a company sees only its own), so nobody else is handed it.
import { and, desc, eq, sql } from 'drizzle-orm';
import { diaryWeeklyPrompt } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import type { LocalDate } from '@archova/time';
import type { DiaryDayForSummary } from '../domain/diary-summary';
import {
  isWeekStart,
  reviewWeeklySummary,
  weekDates,
  weekFacts,
  weekFingerprint,
  type ReviewedWeekly,
  type WeekFacts,
} from '../domain/diary-weekly';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';

export const DIARY_WEEKLY_TASK = diaryWeeklyPrompt.id;
/** A weekly summary belongs to the project, not to one diary entry. */
export const DIARY_WEEKLY_TARGET = 'project';

/** `ai_suggestions.payload` for `diary.weekly`. */
export interface DiaryWeeklyPayload extends ReviewedWeekly {
  weekStart: string;
  weekEnd: string;
  /** Days of the week with a diary entry the asker can read. */
  daysWithEntries: number;
  /** Some day had more lines than the summary reads: its routine lines were left out (delays never are). */
  truncated: boolean;
  /** Delay line hours by cause, added up in code. */
  delayHours: WeekFacts['delayHours'];
  /** `weekFingerprint` of the days it was written from: the cache key. */
  dayHash: string;
}

export interface DiaryWeeklyDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  /** `diary.api.dayForSummary`: the day's lines the caller may see, or null when there is no day or no access. */
  dayForSummary: (
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
  ) => Promise<DiaryDayForSummary | null>;
}

export function createDiaryWeeklyService(deps: DiaryWeeklyDeps) {
  const { database } = deps;

  /** The route's entry point: reads each day as the caller (their access applies) and summarises the week. */
  async function summariseWeek(ctx: TenantContext, projectId: string, weekStart: string) {
    if (!isWeekStart(weekStart))
      throw new AppError('validation_failed', 'The week must start on a Monday, like 2026-10-26.', [
        { path: 'weekStart', message: 'Not a Monday' },
      ]);
    const days = await database.withTenantTx(
      ctx,
      async (scope) => {
        const found: DiaryDayForSummary[] = [];
        for (const date of weekDates(weekStart)) {
          const day = await deps.dayForSummary(scope, projectId, date);
          if (day) found.push(day);
        }
        return found;
      },
      { readOnly: true },
    );
    if (!days.length) throw new AppError('diary.not_found');

    const dayHash = weekFingerprint(weekStart, days);
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
              eq(suggestions.task, DIARY_WEEKLY_TASK),
              eq(suggestions.targetType, DIARY_WEEKLY_TARGET),
              eq(suggestions.targetId, projectId),
              eq(suggestions.promptVersion, diaryWeeklyPrompt.version),
              eq(suggestions.status, 'pending'),
              eq(suggestions.createdBy, scope.ctx.userId),
              sql`${suggestions.payload}->>'weekStart' = ${weekStart}`,
              sql`${suggestions.payload}->>'dayHash' = ${dayHash}`,
            ),
          )
          .orderBy(desc(suggestions.createdAt))
          .limit(1);
        return row ?? null;
      },
      { readOnly: true },
    );
    if (cached) return cached;

    const built = weekFacts(weekStart, days);
    if (!built.facts.length)
      throw new AppError(
        'ai.diary.nothing_to_summarise',
        "There's nothing in this week's diary yet. Add labour, notes or delays, then ask Nova again.",
      );
    const weekEnd = weekDates(weekStart)[6]!;
    const run = await deps.gateway.runTask(
      ctx,
      diaryWeeklyPrompt,
      { weekStart, weekEnd, days: built.days, facts: built.facts },
      { projectId },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't write this summary. Try again.");

    const reviewed = reviewWeeklySummary(run.output, built, weekStart);
    const payload: DiaryWeeklyPayload = {
      weekStart,
      weekEnd,
      daysWithEntries: built.days.length,
      truncated: built.truncated,
      delayHours: built.delayHours,
      dayHash,
      ...reviewed,
    };
    const total = reviewed.sentences.length + reviewed.dropped;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: DIARY_WEEKLY_TARGET,
          targetId: projectId,
          task: DIARY_WEEKLY_TASK,
          promptVersion: diaryWeeklyPrompt.version,
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

  return { summariseWeek };
}

export type DiaryWeeklyService = ReturnType<typeof createDiaryWeeklyService>;
