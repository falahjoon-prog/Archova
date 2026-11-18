// Applies a confirmed voice intent to the site diary through the same offline commands the diary screen uses,
// so a spoken note is queued, synced and amended exactly like a typed one.
import { uuidv7, type DelayType } from '@archova/domain';
import type { LocalDate } from '@archova/time';
import type { SqliteSyncStore } from '../../lib/db/sync-store';
import {
  addDiaryLine,
  getDiaryDay,
  newDelay,
  newLineId,
  setDiaryNotes,
  type DiaryProblem,
} from '../diary/commands';
import type { VoiceIntent } from './parse';

export type VoiceApplyResult =
  { ok: true; saved: 'note' | 'delay' } | { ok: false; code: DiaryProblem | 'voice.not_diary' };

/** A spoken delay is type "weather" when the words say so, else "other". */
const delayTypeOf = (description: string): DelayType =>
  /\b(rain|wind|storm|weather|heat)\b/i.test(description) ? 'weather' : 'other';

/**
 * Save a diary note or delay for `date`. Notes are appended on a new line to what the day already has. A day
 * that is already submitted is not changed by voice: amendments need a typed reason, so it is refused.
 */
export async function applyDiaryVoice(
  store: SqliteSyncStore,
  input: { intent: VoiceIntent; projectId: string; date: LocalDate; now: Date },
): Promise<VoiceApplyResult> {
  const { intent, projectId, date } = input;
  const clientAt = input.now.toISOString();
  if (intent.kind !== 'diary.note' && intent.kind !== 'diary.delay')
    return { ok: false, code: 'voice.not_diary' };
  const day = await getDiaryDay(store, projectId, date);
  if (day.entry.status !== 'draft') return { ok: false, code: 'diary.amendment_reason_required' };
  if (intent.kind === 'diary.note') {
    const existing = day.entry.notesText.trim();
    const r = await setDiaryNotes(store, {
      projectId,
      date,
      notesText: existing ? `${existing}\n${intent.text}` : intent.text,
      mutationId: uuidv7(),
      clientAt,
    });
    return r.ok ? { ok: true, saved: 'note' } : r;
  }
  const r = await addDiaryLine(store, {
    kind: 'delay',
    projectId,
    date,
    lineId: newLineId('delay'),
    mutationId: uuidv7(),
    line: newDelay(delayTypeOf(intent.description), intent.description, intent.hours),
    clientAt,
  });
  return r.ok ? { ok: true, saved: 'delay' } : r;
}
