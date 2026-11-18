import { describe, expect, it, vi } from 'vitest';
import { getDiaryDay, listDiaryLines } from '../features/diary';
import { applyVoiceLog, wholeNote, type VoiceLogItem } from '../features/voice';
import { listIncidents } from '../features/incidents';
import { migrate, SqliteSyncStore } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

vi.mock('../features/diary/screens/DiaryScreen', () => ({}));
vi.mock('../features/voice/screens/VoiceScreen', () => ({}));
vi.mock('../features/voice/screens/VoiceLogScreen', () => ({}));
vi.mock('../features/incidents/screens/IncidentReportScreen', () => ({}));

const P = 'prj_a';
const D = '2026-11-05' as const;
const now = new Date('2026-11-05T01:00:00Z');

async function store() {
  const db = await nodeSqlDriver().open('vl.db');
  await migrate(db);
  return new SqliteSyncStore(db, { moduleOf: () => 'diary' });
}
const item = (over: Partial<VoiceLogItem>): VoiceLogItem => ({
  kind: 'note',
  text: 'Slab poured',
  quote: 'slab poured',
  hours: null,
  delayType: null,
  severity: null,
  dueDate: null,
  ...over,
});

describe('applyVoiceLog', () => {
  it('files notes, tasks, delays and observations as their own offline records', async () => {
    const s = await store();
    const r = await applyVoiceLog(s, {
      projectId: P,
      date: D,
      now,
      items: [
        item({}),
        item({ kind: 'task', text: 'Order props', dueDate: '2026-11-07' }),
        item({ kind: 'delay', text: 'Rain stopped the crane', hours: 2, delayType: 'weather' }),
        item({ kind: 'observation', text: 'Unguarded edge on stair void', severity: 'serious' }),
      ],
    });
    expect(r).toEqual({ ok: true, saved: { notes: 1, delays: 1, observations: 1, tasks: 1 } });
    expect((await getDiaryDay(s, P, D)).entry.notesText).toBe(
      'Slab poured\nTo do: Order props (by 2026-11-07)',
    );
    const delays = await listDiaryLines(s, 'delay', P, D);
    expect(delays).toEqual([expect.objectContaining({ type: 'weather', hours: 2 })]);
    expect(await listIncidents(s, P)).toEqual([
      expect.objectContaining({
        type: 'dangerous_occurrence',
        title: 'Unguarded edge on stair void',
      }),
    ]);
    expect((await s.listOutbox()).map((e) => e.command).sort()).toEqual([
      'diary.addDelay',
      'diary.setNotes',
      'safety.reportIncident',
    ]);
  });

  it('appends to notes already on the day and logs a delay with no stated hours as 0', async () => {
    const s = await store();
    await applyVoiceLog(s, { projectId: P, date: D, now, items: [item({ text: 'First' })] });
    await applyVoiceLog(s, {
      projectId: P,
      date: D,
      now,
      items: [item({ text: 'Second' }), item({ kind: 'delay', text: 'Waiting on sparky' })],
    });
    expect((await getDiaryDay(s, P, D)).entry.notesText).toBe('First\nSecond');
    expect(await listDiaryLines(s, 'delay', P, D)).toEqual([
      expect.objectContaining({ hours: 0, type: 'other' }),
    ]);
  });

  it('leaves a submitted day alone but still reports a safety observation', async () => {
    const s = await store();
    await applyVoiceLog(s, { projectId: P, date: D, now, items: [item({})] });
    const { submitDiaryDay } = await import('../features/diary');
    await submitDiaryDay(s, {
      projectId: P,
      date: D,
      mutationId: 'm1',
      clientAt: now.toISOString(),
    });
    const blocked = await applyVoiceLog(s, {
      projectId: P,
      date: D,
      now,
      items: [item({ text: 'More' })],
    });
    expect(blocked).toEqual({ ok: false, code: 'diary.amendment_reason_required' });
    const obs = await applyVoiceLog(s, {
      projectId: P,
      date: D,
      now,
      items: [item({ kind: 'observation', text: 'Loose sheeting' })],
    });
    expect(obs.ok).toBe(true);
    expect((await listIncidents(s, P))[0]).toEqual(expect.objectContaining({ type: 'near_miss' }));
  });

  it('keeps the whole transcript as one note when Nova is not available', () => {
    expect(wholeNote('  we poured level 4  ')).toEqual([
      expect.objectContaining({ kind: 'note', text: 'we poured level 4' }),
    ]);
    expect(wholeNote('   ')).toEqual([]);
  });
});
