import { describe, expect, it, vi } from 'vitest';
import {
  addDiaryLine,
  attachDayPhoto,
  newLineId,
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
import { UploadQueue, type FileTransfer, type UploadApi } from '../lib/files/upload-queue';
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

describe('site diary ids and photos', () => {
  it('chooses line ids in the server form', () => {
    expect(newLineId('labour')).toMatch(/^dlb_/);
    expect(newLineId('labour')).not.toBe(newLineId('labour'));
  });

  async function photoSetup() {
    const db = await nodeSqlDriver().open('diary-photo.db');
    await migrate(db);
    const s = new SqliteSyncStore(db, { moduleOf: () => 'diary' });
    const api: UploadApi = {
      async createUpload(body) {
        return {
          id: 'upl_1',
          status: 'pending',
          uploadUrl: 'https://s3.example/put',
          uploadMethod: 'PUT',
          uploadHeaders: { 'content-type': body.mime },
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
      },
      async completeUpload() {
        return {
          id: 'fil_9',
          projectId: P,
          module: 'diary',
          filename: 'p.jpg',
          mime: 'image/jpeg',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          status: 'ready',
          capture: null,
          createdAt: new Date().toISOString(),
        };
      },
    };
    const transfer: FileTransfer = { put: async () => ({ status: 200 }) };
    const uploads = new UploadQueue(db, s, api, transfer);
    const taken = (n: number, date = '2026-10-02', amendmentReason?: string) => ({
      projectId: P,
      date: date as `${number}-${number}-${number}`,
      photoId: `pho_${n}`,
      mutationId: `mp${n}`,
      capture: {} as never,
      file: {
        localUri: 'file:///p.jpg',
        thumbnailUri: 'file:///t.jpg',
        filename: 'p.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      },
      amendmentReason,
      clientAt: AT,
    });
    return { s, uploads, deps: { db, store: s, uploads }, taken };
  }

  it('shows a photo on the day at once and holds its command until the file is stored', async () => {
    const { s, uploads, deps, taken } = await photoSetup();
    await addDiaryLine(s, {
      kind: 'labour',
      projectId: P,
      date: '2026-10-02',
      ...ids(),
      line: labour('c1', 2),
      clientAt: AT,
    });
    expect(await attachDayPhoto(deps, taken(1))).toEqual({ ok: true, value: null });
    const day = await getDiaryDay(s, P, '2026-10-02');
    expect(day.entry.localPhotos).toEqual([{ photoId: 'pho_1', thumbnailUri: 'file:///t.jpg' }]);
    const queue = await s.listOutbox();
    expect(queue.map((e) => e.command)).toEqual(['diary.addLabour', 'diary.attachPhoto']);
    expect(queue[1]).toMatchObject({ status: 'held', dependsOn: [queue[0]!.mutationId] });
    expect((await uploads.list()).map((f) => [f.id, f.module])).toEqual([['pho_1', 'diary']]);

    await uploads.drain();
    const sent = (await s.listOutbox())[1]!;
    expect(sent).toMatchObject({
      status: 'pending',
      payload: { projectId: P, date: '2026-10-02', fileId: 'fil_9' },
    });
  });

  it('is submitted after a queued photo, and refused on a submitted day without a reason', async () => {
    const { s, deps, taken } = await photoSetup();
    await attachDayPhoto(deps, taken(1));
    await submitDiaryDay(s, { projectId: P, date: '2026-10-02', mutationId: 'ms', clientAt: AT });
    const queue = await s.listOutbox();
    expect(queue.at(-1)).toMatchObject({ command: 'diary.submit', dependsOn: ['mp1'] });

    expect(await attachDayPhoto(deps, taken(2))).toEqual({
      ok: false,
      code: 'diary.amendment_reason_required',
    });
    expect(await attachDayPhoto(deps, taken(3, '2026-10-02', 'Missed one'))).toEqual({
      ok: true,
      value: null,
    });
  });
});
