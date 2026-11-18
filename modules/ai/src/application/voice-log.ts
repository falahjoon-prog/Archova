// Voice log (mobile F14): the transcript of a site person speaking the day's notes becomes proposed diary records:
// a note, delays, safety observations and tasks. `ai` never writes them: the draft is a pending `ai_suggestions` row
// (task `voice.log`, target the project) that only the asker can list or decide, and the phone saves the records the
// person keeps through its own offline commands. The same transcript for the same day returns the same draft at no cost.
// Only text is sent here; the audio is turned into text on the phone and never leaves it.
import { and, desc, eq, sql } from 'drizzle-orm';
import { voiceLogPrompt, VOICE_LOG_MAX } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext } from '@archova/kernel';
import { isLocalDate, type LocalDate } from '@archova/time';
import { reviewVoiceLog, voiceLogFingerprint, type ReviewedVoiceItem } from '../domain/voice-log';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';

export const VOICE_LOG_TASK = voiceLogPrompt.id;
export const VOICE_LOG_TARGET = 'project';
/** Anything shorter has nothing worth filing. */
const MIN_TRANSCRIPT = 15;

export interface VoiceLogPayload {
  date: string;
  items: ReviewedVoiceItem[];
  dropped: number;
  /** `voiceLogFingerprint` of the day and transcript: the cache key. */
  transcriptHash: string;
}

export interface VoiceLogDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
}

export function createVoiceLogService(deps: VoiceLogDeps) {
  const { database } = deps;

  async function parse(
    ctx: TenantContext,
    projectId: string,
    date: string,
    input: { transcript: string },
    signal?: AbortSignal,
  ) {
    if (!isLocalDate(date))
      throw new AppError('validation_failed', 'That is not a diary date.', [
        { path: 'date', message: 'Use YYYY-MM-DD' },
      ]);
    const transcript = input.transcript.trim();
    if (transcript.length < MIN_TRANSCRIPT)
      throw new AppError(
        'ai.voice_log.nothing_to_file',
        'There was not enough said to file. Record again, or type the note.',
        [{ path: 'transcript', message: 'Too short to find any records in.' }],
      );
    if (transcript.length > VOICE_LOG_MAX)
      throw new AppError(
        'validation_failed',
        'That recording is too long for Nova to read at once.',
        [{ path: 'transcript', message: `Keep it under ${VOICE_LOG_MAX} characters.` }],
      );
    const hash = voiceLogFingerprint(date, transcript);

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
              eq(suggestions.task, VOICE_LOG_TASK),
              eq(suggestions.targetType, VOICE_LOG_TARGET),
              eq(suggestions.targetId, projectId),
              eq(suggestions.promptVersion, voiceLogPrompt.version),
              eq(suggestions.status, 'pending'),
              eq(suggestions.createdBy, scope.ctx.userId),
              sql`${suggestions.payload}->>'transcriptHash' = ${hash}`,
            ),
          )
          .orderBy(desc(suggestions.createdAt))
          .limit(1);
        return row ?? null;
      },
      { readOnly: true },
    );
    if (cached) return cached;

    const run = await deps.gateway.runTask(
      ctx,
      voiceLogPrompt,
      { date: date as LocalDate, transcript },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read that recording. Try again.");

    const reviewed = reviewVoiceLog(run.output, transcript, date as LocalDate);
    const payload: VoiceLogPayload = {
      date,
      items: reviewed.items,
      dropped: reviewed.dropped,
      transcriptHash: hash,
    };
    const total = reviewed.items.length + reviewed.dropped;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: VOICE_LOG_TARGET,
          targetId: projectId,
          task: VOICE_LOG_TASK,
          promptVersion: voiceLogPrompt.version,
          payload,
          confidence: total ? reviewed.items.length / total : 0,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  return { parse };
}

export type VoiceLogService = ReturnType<typeof createVoiceLogService>;
