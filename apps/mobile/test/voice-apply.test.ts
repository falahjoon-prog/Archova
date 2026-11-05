import { describe, expect, it, vi } from 'vitest';
import { getDiaryDay, listDiaryLines, submitDiaryDay } from '../features/diary';
import { applyDiaryVoice, parseVoice } from '../features/voice';
import { migrate, SqliteSyncStore } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

vi.mock('../features/diary/screens/DiaryScreen', () => ({}));
vi.mock('../features/voice/screens/VoiceScreen', () => ({}));

const P = 'prj_a';
const D = '2026-11-05' as const;
const now = new Date('2026-11-05T01:00:00Z');

async function store() {
  const db = await nodeSqlDriver().open('v.db');
  await migrate(db);
  return new SqliteSyncStore(db, { moduleOf: () => 'diary' });
}

describe('applyDiaryVoice', () => {
  it('appends spoken notes to the day', async () => {
    const s = await store();
    await applyDiaryVoice(s, {
      intent: parseVoice('diary note slab poured'),
      projectId: P,
      date: D,
      now,
    });
    const r = await applyDiaryVoice(s, {
      intent: parseVoice('diary note crane booked'),
      projectId: P,
      date: D,
      now,
    });
    expect(r).toEqual({ ok: true, saved: 'note' });
    expect((await getDiaryDay(s, P, D)).entry.notesText).toBe('Slab poured\nCrane booked');
    expect((await s.listOutbox()).map((e) => e.command)).toEqual([
      'diary.setNotes',
      'diary.setNotes',
    ]);
  });
  it('logs a weather delay', async () => {
    const s = await store();
    await applyDiaryVoice(s, {
      intent: parseVoice('log delay rain for two hours'),
      projectId: P,
      date: D,
      now,
    });
    const lines = await listDiaryLines(s, 'delay', P, D);
    expect(lines[0]).toMatchObject({ type: 'weather', hours: 2, description: 'Rain' });
  });
  it('refuses a submitted day and non-diary intents', async () => {
    const s = await store();
    await submitDiaryDay(s, {
      projectId: P,
      date: D,
      mutationId: 'm',
      clientAt: now.toISOString(),
    });
    expect(
      await applyDiaryVoice(s, { intent: parseVoice('diary note x'), projectId: P, date: D, now }),
    ).toEqual({
      ok: false,
      code: 'diary.amendment_reason_required',
    });
    expect(
      await applyDiaryVoice(s, { intent: parseVoice('hey nova hi'), projectId: P, date: D, now }),
    ).toEqual({
      ok: false,
      code: 'voice.not_diary',
    });
  });
});
