// F7 meeting minutes to actions (ai/01 F7, product/07 MTG-US7): the notes someone typed or pasted become proposed
// minute items for the meeting's own sections. `ai` never writes into the minutes: the draft is a pending
// `ai_suggestions` row (task `minutes.extract`, target the project) that only the person who asked can list or decide,
// and the web adds the items they pick through the meetings API. The same notes for the same meeting return the same
// draft at no cost.
import { and, desc, eq, sql } from 'drizzle-orm';
import { meetingMinutesPrompt, MINUTES_NOTES_MAX } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  minutesFingerprint,
  reviewMinutes,
  type MinutesContext,
  type ReviewedMinuteItem,
} from '../domain/meeting-minutes';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';

export const MINUTES_EXTRACT_TASK = meetingMinutesPrompt.id;
export const MINUTES_EXTRACT_TARGET = 'project';

/** Notes shorter than this have nothing to turn into minutes. */
const MIN_NOTES = 20;

/** The meeting as `meetings.api.forMinutesDraft` hands it over: real ids, for the caller who may write the minutes. */
export interface MeetingForMinutes {
  title: string;
  /** The day it was held, in the project's time zone. */
  date: string;
  sections: Array<{ id: string; title: string }>;
  attendees: Array<{ id: string; name: string; company: string }>;
}

export interface MinutesExtractDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  /** `meetings.api.forMinutesDraft`: the meeting, or meeting.not_found / meeting.not_allowed for someone who can't write it. */
  meeting: (scope: TenantScope, projectId: string, meetingId: string) => Promise<MeetingForMinutes>;
}

/** One proposed item in `ai_suggestions.payload`, with real section and attendee ids. */
export interface MinutesDraftItem extends Omit<ReviewedMinuteItem, 'sectionId' | 'ownerId'> {
  sectionId: string | null;
  attendeeId: string | null;
}

/** `ai_suggestions.payload` for `minutes.extract`. */
export interface MinutesExtractPayload {
  meetingId: string;
  items: MinutesDraftItem[];
  /** Items the model proposed that failed the checks (a quote not in the notes, a repeat). */
  dropped: number;
  /** `minutesFingerprint` of the notes and meeting it was written from: the cache key. */
  notesHash: string;
}

export function createMinutesExtractService(deps: MinutesExtractDeps) {
  const { database } = deps;

  async function extract(
    ctx: TenantContext,
    projectId: string,
    meetingId: string,
    input: { notes: string },
    signal?: AbortSignal,
  ) {
    const notes = input.notes.trim();
    if (notes.length < MIN_NOTES)
      throw new AppError(
        'ai.minutes.nothing_to_extract',
        'Paste or type the meeting notes first, then ask Nova.',
        [{ path: 'notes', message: 'Too short to find any minutes in.' }],
      );
    if (notes.length > MINUTES_NOTES_MAX)
      throw new AppError(
        'validation_failed',
        'These notes are too long for Nova to read at once.',
        [{ path: 'notes', message: `Keep notes under ${MINUTES_NOTES_MAX} characters.` }],
      );

    const meeting = await database.withTenantTx(
      ctx,
      (scope) => deps.meeting(scope, projectId, meetingId),
      { readOnly: true },
    );
    // The model sees short ids (s1, a2); the saved draft maps them back to the real ones.
    const sections = meeting.sections.map((s, i) => ({ id: `s${i + 1}`, title: s.title }));
    const attendees = meeting.attendees.map((a, i) => ({
      id: `a${i + 1}`,
      name: a.name,
      company: a.company,
    }));
    const context: MinutesContext = {
      title: meeting.title,
      date: meeting.date,
      sections,
      attendees,
    };
    const notesHash = minutesFingerprint(notes, context);

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
              eq(suggestions.task, MINUTES_EXTRACT_TASK),
              eq(suggestions.targetType, MINUTES_EXTRACT_TARGET),
              eq(suggestions.targetId, projectId),
              eq(suggestions.promptVersion, meetingMinutesPrompt.version),
              eq(suggestions.status, 'pending'),
              eq(suggestions.createdBy, scope.ctx.userId),
              sql`${suggestions.payload}->>'meetingId' = ${meetingId}`,
              sql`${suggestions.payload}->>'notesHash' = ${notesHash}`,
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
      meetingMinutesPrompt,
      { ...context, notes },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read these notes. Try again.");

    const reviewed = reviewMinutes(run.output, notes, context);
    const sectionId = new Map(meeting.sections.map((s, i) => [`s${i + 1}`, s.id]));
    const attendeeId = new Map(meeting.attendees.map((a, i) => [`a${i + 1}`, a.id]));
    const payload: MinutesExtractPayload = {
      meetingId,
      items: reviewed.items.map(({ sectionId: s, ownerId: o, ...item }) => ({
        ...item,
        sectionId: s ? (sectionId.get(s) ?? null) : null,
        attendeeId: o ? (attendeeId.get(o) ?? null) : null,
      })),
      dropped: reviewed.dropped,
      notesHash,
    };
    const total = reviewed.items.length + reviewed.dropped;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: MINUTES_EXTRACT_TARGET,
          targetId: projectId,
          task: MINUTES_EXTRACT_TASK,
          promptVersion: meetingMinutesPrompt.version,
          payload,
          // Share of the model's items that passed the checks.
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

  return { extract };
}

export type MinutesExtractService = ReturnType<typeof createMinutesExtractService>;
