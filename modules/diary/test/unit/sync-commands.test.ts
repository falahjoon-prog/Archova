import { describe, expect, it, vi } from 'vitest';
import { encodeId } from '@archova/domain';
import { AppError, type SyncCommand, type TenantScope } from '@archova/kernel';
import type { DiaryService } from '../../src/application/diary';
import { diarySyncCommands } from '../../src/api/sync';

const U = (n: number) => `0191a5b0-0000-7000-8000-00000000000${n}`;
const scope = {} as TenantScope;
const project = encodeId('project', U(1));
const company = encodeId('company', U(2));

function fake() {
  const service = {
    createLine: vi.fn(async () => ({ version: 1 })),
    deleteLine: vi.fn(async () => undefined),
    saveHeader: vi.fn(async () => ({ entry: { version: 5 } })),
    submit: vi.fn(async () => ({ entry: { version: 6 } })),
    detail: vi.fn(async () => ({ entry: { version: 4, fileIds: ['f0'] } })),
    currentVersion: vi.fn(async (): Promise<number | null> => 4),
  };
  const access = { assert: vi.fn(async () => ({}) as never) };
  const commands = diarySyncCommands(service as unknown as DiaryService, access);
  const get = (name: string): SyncCommand => commands.find((c) => c.name === name)!;
  return { service, access, commands, get };
}
const m = (over: object) => ({
  entityId: encodeId('diaryLabour', U(3)),
  baseVersion: null,
  clientAt: new Date('2026-11-05T01:00:00Z'),
  payload: {},
  ...over,
});
const day = { projectId: project, date: '2026-11-05' };

describe('diary sync commands', () => {
  it('registers add and remove for each line kind, notes, photo and submit', () => {
    const names = fake().commands.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'diary.addLabour',
        'diary.removeLabour',
        'diary.addPlant',
        'diary.removePlant',
        'diary.addDelivery',
        'diary.removeDelivery',
        'diary.addDelay',
        'diary.removeDelay',
        'diary.setNotes',
        'diary.attachPhoto',
        'diary.submit',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('adds a line under the id the device chose, checking the write permission first', async () => {
    const { service, access, get } = fake();
    const r = await get('diary.addLabour').run(
      scope,
      m({
        payload: {
          ...day,
          companyId: company,
          companyName: 'Acme',
          headcount: 4,
          hours: 8,
          amendmentReason: ' ',
        },
      }),
    );
    expect(r).toEqual({ version: 1 });
    expect(access.assert).toHaveBeenCalledWith(scope, 'diary.entries.write', { projectId: U(1) });
    expect(service.createLine).toHaveBeenCalledWith(
      scope,
      U(1),
      '2026-11-05',
      'labour',
      { companyId: U(2), companyName: 'Acme', headcount: 4, hours: 8 },
      undefined,
      U(3),
    );
  });

  it('refuses to run without the permission', async () => {
    const { service, access, get } = fake();
    access.assert.mockRejectedValueOnce(new AppError('access.denied'));
    await expect(
      get('diary.addPlant').run(scope, m({ entityId: encodeId('diaryPlant', U(3)), payload: day })),
    ).rejects.toMatchObject({
      code: 'access.denied',
    });
    expect(service.createLine).not.toHaveBeenCalled();
  });

  it('rejects bad ids, days and reasons before touching the diary', async () => {
    const { service, get } = fake();
    const add = get('diary.addDelay').run;
    await expect(add(scope, m({ entityId: 'nope', payload: day }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(add(scope, m({ payload: { ...day, projectId: 'x' } }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(add(scope, m({ payload: { ...day, date: '5/11' } }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(add(scope, m({ payload: { ...day, amendmentReason: 7 } }))).rejects.toBeInstanceOf(
      AppError,
    );
    expect(service.createLine).not.toHaveBeenCalled();
  });

  it('removes a line with the amendment reason', async () => {
    const { service, get } = fake();
    await get('diary.removePlant').run(
      scope,
      m({
        entityId: encodeId('diaryPlant', U(3)),
        payload: { ...day, amendmentReason: 'Wrong machine' },
      }),
    );
    expect(service.deleteLine).toHaveBeenCalledWith(
      scope,
      U(1),
      '2026-11-05',
      'plant',
      U(3),
      'Wrong machine',
    );
  });

  it('sets the notes against the version the phone saw, or the current one if it saw none', async () => {
    const { service, get } = fake();
    const notes = get('diary.setNotes');
    expect(
      await notes.run(
        scope,
        m({ baseVersion: 3, payload: { ...day, notesText: 'Rain stopped work' } }),
      ),
    ).toEqual({ version: 5 });
    expect(service.saveHeader).toHaveBeenLastCalledWith(
      scope,
      U(1),
      '2026-11-05',
      3,
      { notes: 'Rain stopped work' },
      undefined,
    );
    await notes.run(scope, m({ payload: { ...day, notesText: '   ' } }));
    expect(service.saveHeader).toHaveBeenLastCalledWith(
      scope,
      U(1),
      '2026-11-05',
      4,
      { notes: null },
      undefined,
    );
    await expect(notes.run(scope, m({ payload: { ...day, notesText: 5 } }))).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('adds a photo to the day without repeating one', async () => {
    const { service, get } = fake();
    const photo = get('diary.attachPhoto');
    const file = encodeId('file', U(5));
    expect(await photo.run(scope, m({ payload: { ...day, fileId: file } }))).toEqual({
      version: 5,
    });
    expect(service.saveHeader).toHaveBeenCalledWith(
      scope,
      U(1),
      '2026-11-05',
      4,
      { fileIds: ['f0', U(5)] },
      undefined,
    );
    service.saveHeader.mockClear();
    service.detail.mockResolvedValueOnce({ entry: { version: 4, fileIds: [U(5)] } } as never);
    expect(await photo.run(scope, m({ payload: { ...day, fileId: file } }))).toEqual({
      version: 4,
    });
    expect(service.saveHeader).not.toHaveBeenCalled();
    await expect(photo.run(scope, m({ payload: { ...day, fileId: 'x' } }))).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('starts a photo day that does not exist yet', async () => {
    const { service, get } = fake();
    service.detail.mockRejectedValueOnce(new AppError('diary.not_found'));
    service.currentVersion.mockResolvedValueOnce(null);
    await get('diary.attachPhoto').run(
      scope,
      m({ payload: { ...day, fileId: encodeId('file', U(5)) } }),
    );
    expect(service.saveHeader).toHaveBeenCalledWith(
      scope,
      U(1),
      '2026-11-05',
      null,
      { fileIds: [U(5)] },
      undefined,
    );
  });

  it('submits with the phone time, and says when there is nothing to submit', async () => {
    const { service, get } = fake();
    const clientAt = new Date('2026-11-05T07:00:00Z');
    expect(
      await get('diary.submit').run(scope, m({ baseVersion: 2, clientAt, payload: day })),
    ).toEqual({
      version: 6,
    });
    expect(service.submit).toHaveBeenCalledWith(scope, U(1), '2026-11-05', 2, clientAt);
    service.currentVersion.mockResolvedValueOnce(null);
    await expect(get('diary.submit').run(scope, m({ payload: day }))).rejects.toMatchObject({
      code: 'diary.not_found',
    });
  });

  it('has no earlier copy to hand back for a conflict', async () => {
    const { commands } = fake();
    for (const c of commands) expect(await c.current(scope, 'x')).toBeNull();
  });
});
