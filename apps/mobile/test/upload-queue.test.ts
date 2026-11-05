import type { FileObject, Upload } from '@archova/contracts';
import { describe, expect, it, vi } from 'vitest';
import { capturePhoto } from '../features/photos';
import { migrate, SqliteSyncStore } from '../lib/db';
import {
  UploadHttpError,
  UploadQueue,
  type FileTransfer,
  type UploadApi,
} from '../lib/files/upload-queue';
import { nodeSqlDriver } from './support/node-sql';

// The screen needs React Native; these tests cover the command and the queue only.
vi.mock('../features/photos/screens/CaptureScreen', () => ({ CaptureScreen: () => null }));

const T0 = Date.parse('2026-10-02T23:30:00.000Z');

async function setup() {
  const db = await nodeSqlDriver().open('test.db');
  await migrate(db);
  const store = new SqliteSyncStore(db, {
    moduleOf: (t) => (t === 'photo' ? 'photos' : 'defects'),
  });
  let now = T0;
  let sessions = 0;
  const calls: string[] = [];
  const failures: unknown[] = [];
  const putStatuses: number[] = [];
  let completeStatus: FileObject['status'] = 'scanning';
  const api: UploadApi = {
    async createUpload(body, key) {
      calls.push(`create:${key}`);
      const f = failures.shift();
      if (f) throw f;
      sessions++;
      return {
        id: `upl_${sessions}`,
        status: 'pending',
        uploadUrl: `https://s3.example/put/${sessions}`,
        uploadMethod: 'PUT',
        uploadHeaders: { 'content-type': body.mime },
        expiresAt: new Date(now + 15 * 60_000).toISOString(),
      } satisfies Upload;
    },
    async completeUpload(uploadId) {
      calls.push(`complete:${uploadId}`);
      return {
        id: 'fil_1',
        projectId: 'prj_a',
        module: 'photos',
        filename: 'p.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        status: completeStatus,
        capture: null,
        createdAt: new Date(now).toISOString(),
      };
    },
  };
  const transfer: FileTransfer = {
    async put(url) {
      calls.push(`put:${url}`);
      return { status: putStatuses.shift() ?? 200 };
    },
  };
  const uploads = new UploadQueue(db, store, api, transfer, () => now);
  const capture = { takenAt: new Date(T0).toISOString(), timeZone: 'Australia/Brisbane' };
  const take = (id = 'pho_1') =>
    capturePhoto(
      { db, store, uploads },
      {
        photoId: id,
        mutationId: `m_${id}`,
        projectId: 'prj_a',
        defectId: 'dfx_1',
        dependsOn: ['m_defect'],
        capture,
        clientAt: capture.takenAt,
        file: {
          localUri: `file:///photos/${id}.jpg`,
          thumbnailUri: `file:///photos/${id}.thumb.jpg`,
          filename: `${id}.jpg`,
          mime: 'image/jpeg',
          sizeBytes: 812_000,
          sha256: 'a'.repeat(64),
        },
      },
    );
  return {
    db,
    store,
    uploads,
    calls,
    failures,
    putStatuses,
    take,
    setCompleteStatus: (s: FileObject['status']) => (completeStatus = s),
    advance: (ms: number) => (now += ms),
  };
}

describe('photo capture and the upload queue', () => {
  it('saves the photo at once and queues defects.attachPhoto with the file id once stored', async () => {
    const t = await setup();
    await t.take();
    expect(await t.store.get('photo', 'pho_1')).toMatchObject({
      pending: true,
      data: { fileId: null },
    });
    expect(await t.store.listOutbox()).toMatchObject([{ mutationId: 'm_pho_1', status: 'held' }]);
    expect(await t.uploads.waitingCount()).toBe(1);

    expect(await t.uploads.drain()).toEqual({ completed: 1, failed: 0, retry: false });

    expect(t.calls).toEqual(['create:pho_1', 'put:https://s3.example/put/1', 'complete:upl_1']);
    expect(await t.store.listOutbox()).toMatchObject([
      {
        mutationId: 'm_pho_1',
        status: 'pending',
        command: 'defects.attachPhoto',
        entityId: 'dfx_1',
        dependsOn: ['m_defect'],
        clientAt: '2026-10-02T23:30:00.000Z',
        payload: { fileId: 'fil_1', purpose: 'before' },
      },
    ]);
    expect(await t.uploads.waitingCount()).toBe(0);
  });

  it('keeps the file and its progress when the signal drops, and resumes where it stopped', async () => {
    const t = await setup();
    await t.take('pho_1');
    await t.take('pho_2');
    t.putStatuses.push(0);
    // status 0 from the transfer is treated as a retryable network failure
    const first = await t.uploads.drain();
    expect(first).toEqual({ completed: 0, failed: 0, retry: true });
    expect((await t.uploads.list()).map((f) => [f.id, f.state, f.attempts])).toEqual([
      ['pho_1', 'uploading', 1],
      ['pho_2', 'queued', 0],
    ]);
    expect(await t.uploads.drain()).toEqual({ completed: 2, failed: 0, retry: false });
    // pho_1 reused its upload session rather than starting a new one.
    expect(t.calls.filter((c) => c.startsWith('create'))).toEqual(['create:pho_1', 'create:pho_2']);
  });

  it('starts a new session with a new idempotency key when the presigned URL has expired', async () => {
    const t = await setup();
    await t.take();
    t.putStatuses.push(503);
    await t.uploads.drain();
    t.advance(20 * 60_000);
    await t.uploads.drain();
    expect(t.calls.filter((c) => c.startsWith('create'))).toEqual([
      'create:pho_1',
      'create:pho_1.2',
    ]);
    expect((await t.uploads.list())[0]!.state).toBe('completed');
  });

  it('does not retry a file the server refused', async () => {
    const t = await setup();
    await t.take('pho_1');
    await t.take('pho_2');
    t.failures.push(new UploadHttpError(413, 'file.too_large'));
    expect(await t.uploads.drain()).toEqual({ completed: 1, failed: 1, retry: false });
    expect((await t.uploads.list()).map((f) => [f.id, f.state, f.lastError])).toEqual([
      ['pho_1', 'failed', 'file.too_large'],
      ['pho_2', 'completed', null],
    ]);
  });

  it('marks an infected file as failed and shows its photo under Needs attention', async () => {
    const t = await setup();
    await t.take();
    t.setCompleteStatus('infected');
    expect(await t.uploads.drain()).toEqual({ completed: 0, failed: 1, retry: false });
    expect(await t.store.listOutbox()).toMatchObject([
      {
        mutationId: 'm_pho_1',
        status: 'needs_attention',
        attention: { kind: 'rejected', problem: { code: 'file_infected' } },
      },
    ]);
    expect((await t.uploads.list())[0]).toMatchObject({
      state: 'failed',
      lastError: 'file_infected',
    });
  });
});
