// Voice log on the phone: a dictated day is sent to Nova as text, comes back as proposed records, and the ones the
// person keeps are saved through the same offline commands as typing (diary notes and delays, incident reports).
// Nothing is saved until the person confirms, and a day that is already submitted is not changed by voice.
import { unwrap, type ApiClient } from '@archova/api-client';
import { uuidv7, type DelayType } from '@archova/domain';
import type { LocalDate } from '@archova/time';
import type { SqliteSyncStore } from '../../lib/db/sync-store';
import { reportIncident } from '../incidents';
import {
  addDiaryLine,
  getDiaryDay,
  newDelay,
  newLineId,
  setDiaryNotes,
  type DiaryProblem,
} from '../diary/commands';

export type VoiceLogKind = 'note' | 'delay' | 'observation' | 'task';

/** One proposed record, as the review screen shows and edits it. */
export interface VoiceLogItem {
  kind: VoiceLogKind;
  text: string;
  quote: string;
  hours: number | null;
  delayType: DelayType | null;
  severity: 'minor' | 'serious' | null;
  dueDate: string | null;
}

export const kindLabel: Record<VoiceLogKind, string> = {
  note: 'Diary note',
  delay: 'Delay',
  observation: 'Safety observation',
  task: 'Task',
};

/** Ask Nova to split a transcript into records. Online only; the caller falls back to `wholeNote` when it fails. */
export async function sortVoiceLog(
  api: ApiClient,
  t: { orgId: string; projectId: string },
  date: LocalDate,
  transcript: string,
): Promise<{ items: VoiceLogItem[]; dropped: number }> {
  const s = unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/diary/{date}/nova-voice-log', {
      params: { path: { orgId: t.orgId, projectId: t.projectId, date } },
      body: { transcript },
    }),
  );
  const p = s.payload as { items?: VoiceLogItem[]; dropped?: number };
  return { items: p.items ?? [], dropped: p.dropped ?? 0 };
}

/** Without Nova (offline, or it failed) the whole transcript is kept as one diary note for the person to review. */
export const wholeNote = (transcript: string): VoiceLogItem[] =>
  transcript.trim()
    ? [
        {
          kind: 'note',
          text: transcript.trim(),
          quote: transcript.trim().slice(0, 500),
          hours: null,
          delayType: null,
          severity: null,
          dueDate: null,
        },
      ]
    : [];

const taskLine = (i: VoiceLogItem) => `To do: ${i.text}${i.dueDate ? ` (by ${i.dueDate})` : ''}`;

export type VoiceLogResult =
  | { ok: true; saved: { notes: number; delays: number; observations: number; tasks: number } }
  | { ok: false; code: DiaryProblem };

/**
 * Save the kept records. Notes and tasks join the day's notes in one write, tasks as "To do:" lines (there is no
 * task register on the phone yet); delays are delay lines; observations are reported as incidents (a near miss, or a
 * dangerous occurrence when Nova heard it was serious) so the site team sees them at once.
 */
export async function applyVoiceLog(
  store: SqliteSyncStore,
  input: { items: VoiceLogItem[]; projectId: string; date: LocalDate; now: Date },
): Promise<VoiceLogResult> {
  const { items, projectId, date } = input;
  const clientAt = input.now.toISOString();
  const notes = items.filter((i) => i.kind === 'note' && i.text.trim());
  const tasks = items.filter((i) => i.kind === 'task' && i.text.trim());
  const delays = items.filter((i) => i.kind === 'delay' && i.text.trim());
  const observations = items.filter((i) => i.kind === 'observation' && i.text.trim());

  if (notes.length + tasks.length + delays.length > 0) {
    const day = await getDiaryDay(store, projectId, date);
    if (day.entry.status !== 'draft') return { ok: false, code: 'diary.amendment_reason_required' };
  }
  if (notes.length + tasks.length > 0) {
    const day = await getDiaryDay(store, projectId, date);
    const added = [...notes.map((n) => n.text.trim()), ...tasks.map(taskLine)].join('\n');
    const existing = day.entry.notesText.trim();
    const r = await setDiaryNotes(store, {
      projectId,
      date,
      notesText: existing ? `${existing}\n${added}` : added,
      mutationId: uuidv7(),
      clientAt,
    });
    if (!r.ok) return r;
  }
  for (const d of delays) {
    const r = await addDiaryLine(store, {
      kind: 'delay',
      projectId,
      date,
      lineId: newLineId('delay'),
      mutationId: uuidv7(),
      line: newDelay(d.delayType ?? 'other', d.text.trim(), d.hours ?? 0),
      clientAt,
    });
    if (!r.ok) return r;
  }
  for (const o of observations) {
    await reportIncident(store, {
      projectId,
      title: o.text.trim().slice(0, 120),
      type: o.severity === 'serious' ? 'dangerous_occurrence' : 'near_miss',
      occurredAt: clientAt,
      description: o.text.trim(),
      mutationId: uuidv7(),
      clientAt,
    });
  }
  return {
    ok: true,
    saved: {
      notes: notes.length,
      delays: delays.length,
      observations: observations.length,
      tasks: tasks.length,
    },
  };
}
