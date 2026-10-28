import { describe, expect, it, vi } from 'vitest';
import {
  addDiaryLine,
  diaryToday,
  getDiaryDay,
  labourTotals,
  listDiaryLines,
  newDelay,
  removeDiaryLine,
  setDiaryNotes,
  submitDiaryDay,
  yesterdaysCompanies,
} from '../features/diary';
import { migrate, SqliteSyncStore } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

vi.mock('../features/diary/screens/DiaryScreen', () => ({}));

const P = 'prj_a';
const AT = '2026-10-02T06:00:00.000Z';

async function store() {
  const db = await nodeSqlDriver().open('t.db');
  await migrate(db);
  return new SqliteSyncStore(db, { moduleOf: () => 'diary' });
}

let n = 0;
const ids = () => ({ lineId: `l${++n}`, mutationId: `m${n}` });

const labour = (companyId: string, headcount: number, hours = 8) => ({
  companyId,
  companyName: companyId.toUpperCase(),
  trade: 'Formwork',
  headcount,
  hours,
  notes: null,
});

describe('site diary', () => {
  it("opens on today's date in the project's zone, not the phone's", () => {
    // 11 pm UTC on 2 Oct is already 3 Oct in Sydney and Perth; 3:30 pm UTC is still 2 Oct in Perth.
    expect(diaryToday(new Date('2026-10-02T23:00:00Z'), 'Australia/Sydney')).toBe('2026-10-03');
    expect(diaryToday(new Date('2026-10-02T23:00:00Z'), 'Australia/Perth')).toBe('2026-10-03');
    expect(diaryToday(new Date('2026-10-02T15:30:00Z'), 'Australia/Perth')).toBe('2026-10-02');
  });

  it('records labour by company with live totals, and validates input', async () => {
    const s = await store();
    const date = '2026-10-02';
    expect(
      await addDiaryLine(s, {
        kind: 'labour',
        projectId: P,
        date,
        ...ids(),
        line: labour('co_a', 6),
        clientAt: AT,
      }),
    ).toMatchObject({ ok: true });
    await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date,
      ...ids(),
      line: labour('co_b', 3, 7.5),
      clientAt: AT,
    });
    expect(
      await addDiaryLine(s, {
        kind: 'labour',
        projectId: P,
        date,
        ...ids(),
        line: labour('co_c', 0),
        clientAt: AT,
      }),
    ).toEqual({ ok: false, code: 'diary.headcount_invalid' });

    const lines = await listDiaryLines(s, 'labour', P, date);
    expect(lines.map((l) => l.companyId)).toEqual(['co_a', 'co_b']);
    expect(labourTotals(lines)).toEqual({ headcount: 9, personHours: 70.5 });
    expect((await s.listOutbox()).map((e) => e.command)).toEqual([
      'diary.addLabour',
      'diary.addLabour',
    ]);
    expect((await s.listOutbox())[0]!.payload).toMatchObject({ projectId: P, date, headcount: 6 });
  });

  it("starts today's labour from yesterday's companies with the headcount left blank", async () => {
    const s = await store();
    await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date: '2026-10-01',
      ...ids(),
      line: labour('co_a', 6),
      clientAt: AT,
    });
    await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date: '2026-10-01',
      ...ids(),
      line: labour('co_a', 2),
      clientAt: AT,
    });
    expect(await yesterdaysCompanies(s, P, '2026-10-01')).toEqual([
      { companyId: 'co_a', companyName: 'CO_A', trade: 'Formwork' },
    ]);
  });

  it('ticks possible EOT for a weather delay', async () => {
    const s = await store();
    await addDiaryLine(s, {
      kind: 'delay',
      projectId: P,
      date: '2026-10-02',
      ...ids(),
      line: newDelay('weather', 'Stood down, 18 mm rain', 4),
      clientAt: AT,
    });
    expect(await listDiaryLines(s, 'delay', P, '2026-10-02')).toMatchObject([
      { type: 'weather', isEotCandidate: true, hours: 4 },
    ]);
  });

  it('submits after every queued change to the day, then needs a reason to amend', async () => {
    const s = await store();
    const date = '2026-10-02';
    await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date,
      ...ids(),
      line: labour('co_a', 6),
      clientAt: AT,
    });
    await setDiaryNotes(s, {
      projectId: P,
      date,
      notesText: 'Level 3 slab poured',
      mutationId: 'notes',
      clientAt: AT,
    });
    const queued = (await s.listOutbox()).map((e) => e.mutationId);

    await submitDiaryDay(s, { projectId: P, date, mutationId: 'submit', clientAt: AT });
    const submit = (await s.listOutbox()).at(-1)!;
    expect(submit).toMatchObject({ command: 'diary.submit', clientAt: AT, dependsOn: queued });
    expect((await getDiaryDay(s, P, date)).entry).toMatchObject({
      status: 'submitted',
      submittedAt: AT,
    });

    const line = await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date,
      ...ids(),
      line: labour('co_b', 2),
      clientAt: AT,
    });
    expect(line).toEqual({ ok: false, code: 'diary.amendment_reason_required' });
    const amended = await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date,
      ...ids(),
      line: labour('co_b', 2),
      amendmentReason: 'Electricians left off',
      clientAt: AT,
    });
    expect(amended).toMatchObject({ ok: true });
    expect((await s.listOutbox()).at(-1)!.payload).toMatchObject({
      amendmentReason: 'Electricians left off',
    });
  });

  it('removes a line', async () => {
    const s = await store();
    const date = '2026-10-02';
    const added = ids();
    await addDiaryLine(s, {
      kind: 'plant',
      projectId: P,
      date,
      ...added,
      line: {
        description: '20 t excavator',
        companyId: null,
        quantity: 1,
        hours: 6,
        status: 'working',
      },
      clientAt: AT,
    });
    await removeDiaryLine(s, {
      kind: 'plant',
      projectId: P,
      date,
      lineId: added.lineId,
      mutationId: 'rm',
      clientAt: AT,
    });
    expect(await listDiaryLines(s, 'plant', P, date)).toEqual([]);
    expect((await s.listOutbox()).map((e) => e.command)).toEqual([
      'diary.addPlant',
      'diary.removePlant',
    ]);
  });

  it("prefers the server's copy of the day once it has been pulled", async () => {
    const s = await store();
    await s.applyPull({
      changes: [
        {
          entityType: 'diary_entry',
          id: 'dia_1',
          op: 'upsert',
          version: 3,
          data: {
            id: 'dia_1',
            projectId: P,
            date: '2026-10-02',
            status: 'draft',
            notesText: '',
            weather: { rainMm: 18 },
            submittedAt: null,
          },
        },
      ],
      scopeKeys: [],
      nextSince: '1',
    });
    expect(await getDiaryDay(s, P, '2026-10-02')).toMatchObject({
      version: 3,
      entry: { id: 'dia_1', weather: { rainMm: 18 } },
    });
  });
});
