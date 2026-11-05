import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/inspections/screens/InspectionListScreen', () => ({}));
vi.mock('../features/inspections/screens/InspectionScreen', () => ({}));
import { migrate, SqliteSyncStore } from '../lib/db';
import {
  attachItemPhoto,
  getInspection,
  latestTemplates,
  listInspections,
  listTemplates,
  saveAnswer,
  startInspection,
  submitInspection,
  type LocalTemplate,
  type LocalInspection,
} from '../features/inspections';
import { UploadQueue, type FileTransfer, type UploadApi } from '../lib/files/upload-queue';
import { nodeSqlDriver } from './support/node-sql';

const item = (id: string, over: object = {}) => ({
  id,
  prompt: `Check ${id}`,
  section: 'Slab',
  sort: 0,
  responseType: 'pass_fail_na',
  options: [],
  required: true,
  createsDefectOnFail: false,
  ...over,
});

const pulled = {
  id: 'ins_1',
  projectId: 'prj_1',
  numberLabel: 'INS-0001',
  title: 'Pre-pour',
  location: 'Level 2',
  status: 'scheduled',
  completedAt: null,
  signedBy: null,
  items: [
    item('a'),
    item('b', { responseType: 'text', sort: 1 }),
    item('c', { required: false, sort: 2 }),
  ],
  responses: [],
  missingRequiredItemIds: ['a', 'b'],
  failedItemIds: [],
  version: 3,
};

async function setup() {
  const db = await nodeSqlDriver().open('ins.db');
  await migrate(db);
  const store = new SqliteSyncStore(db, { moduleOf: () => 'quality' });
  await store.applyPull({
    changes: [{ op: 'upsert', entityType: 'inspection', id: 'ins_1', version: 3, data: pulled }],
    scopeKeys: ['project:prj_1:quality'],
    nextSince: '1',
  });
  const read = async () => (await getInspection(store, 'ins_1'))!;
  return { store, read };
}
const at = '2026-11-05T01:00:00.000Z';

describe('inspections offline', () => {
  it('lists pulled inspections for a project', async () => {
    const { store } = await setup();
    const rows = await listInspections(store, 'prj_1');
    expect(rows.map((r) => r.numberLabel)).toEqual(['INS-0001']);
  });

  it('saves an answer locally, updates what is left, and queues the command', async () => {
    const { store, read } = await setup();
    const { inspection, version } = await read();
    const r = await saveAnswer(store, {
      inspection,
      version,
      itemId: 'a',
      answer: { result: 'fail', note: 'Cracked' },
      mutationId: 'm1',
      clientAt: at,
    });
    expect(r.ok).toBe(true);
    const after = (await read()).inspection;
    expect(after.status).toBe('in_progress');
    expect(after.missingRequiredItemIds).toEqual(['b']);
    expect(after.failedItemIds).toEqual(['a']);
    const [queued] = await store.listOutbox();
    expect(queued).toMatchObject({
      command: 'quality.recordResponses',
      baseVersion: 3,
      entityId: 'ins_1',
    });
    expect(queued!.payload).toEqual({
      responses: [{ templateItemId: 'a', result: 'fail', note: 'Cracked' }],
    });
  });

  it('refuses an answer that does not fit the item', async () => {
    const { store, read } = await setup();
    const { inspection, version } = await read();
    const r = await saveAnswer(store, {
      inspection,
      version,
      itemId: 'b',
      answer: { value: '   ' },
      mutationId: 'm1',
      clientAt: at,
    });
    expect(r).toMatchObject({ ok: false, code: 'inspection.invalid_answer' });
    expect(await store.listOutbox()).toHaveLength(0);
  });

  it('blocks submit until required items are answered and a name is given, then queues it', async () => {
    const { store, read } = await setup();
    let { inspection, version } = await read();
    expect(
      await submitInspection(store, {
        inspection,
        version,
        signedByName: 'Sam',
        mutationId: 's0',
        clientAt: at,
      }),
    ).toMatchObject({ ok: false, code: 'inspection.incomplete' });
    for (const [id, a] of [
      ['a', { result: 'pass' as const }],
      ['b', { value: 'Fine' }],
    ] as const) {
      ({ inspection, version } = await read());
      await saveAnswer(store, {
        inspection,
        version,
        itemId: id,
        answer: a,
        mutationId: `m-${id}`,
        clientAt: at,
      });
    }
    ({ inspection, version } = await read());
    expect(
      await submitInspection(store, {
        inspection,
        version,
        signedByName: ' ',
        mutationId: 's1',
        clientAt: at,
      }),
    ).toMatchObject({ ok: false, code: 'inspection.signer_required' });
    const ok = await submitInspection(store, {
      inspection,
      version,
      signedByName: ' Sam ',
      mutationId: 's2',
      clientAt: at,
    });
    expect(ok.ok).toBe(true);
    const out = await store.listOutbox();
    expect(out.map((e) => e.command)).toEqual([
      'quality.recordResponses',
      'quality.recordResponses',
      'quality.submit',
    ]);
    // All three were made on the same server version, so the engine rebases them as the earlier ones apply.
    expect(out.map((e) => e.baseVersion)).toEqual([3, 3, 3]);
    expect(out[2]!.payload).toEqual({ signedByName: 'Sam' });
    const final = (await read()).inspection as LocalInspection;
    expect(final.status).toBe('submitted');
    expect(
      await saveAnswer(store, {
        inspection: final,
        version,
        itemId: 'c',
        answer: { result: 'pass' },
        mutationId: 'x',
        clientAt: at,
      }),
    ).toMatchObject({ ok: false, code: 'inspection.not_editable' });
  });
});

describe('start from a template', () => {
  const template = (over: Partial<LocalTemplate> = {}): LocalTemplate => ({
    id: 'tpl_1',
    projectId: 'prj_1',
    name: 'Pre-pour',
    type: 'inspection',
    version: 1,
    published: true,
    items: [item('a'), item('b', { responseType: 'text', sort: 1 })] as never,
    ...over,
  });

  it('offers the latest published version of each checklist', () => {
    const list = latestTemplates([
      template({ id: 't1', version: 1 }),
      template({ id: 't2', version: 3 }),
      template({ id: 't3', version: 4, published: false }),
      template({ id: 't4', name: 'Handover', version: 1 }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['t4', 't2']);
  });

  it('lists the templates held on the device for a project', async () => {
    const { store } = await setup();
    await store.applyPull({
      changes: [
        {
          op: 'upsert',
          entityType: 'inspection_template',
          id: 'tpl_1',
          version: 1,
          data: template(),
        },
      ],
      scopeKeys: ['project:prj_1:quality'],
      nextSince: '2',
    });
    expect((await listTemplates(store, 'prj_1')).map((t) => t.id)).toEqual(['tpl_1']);
    expect(await listTemplates(store, 'prj_other')).toEqual([]);
  });

  it('starts an inspection on the device and queues it, then answers and submits queue behind it', async () => {
    const { store } = await setup();
    const r = await startInspection(store, {
      template: template(),
      location: ' Level 3 ',
      mutationId: 'm-start',
      clientAt: at,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inspection = r.value;
    expect(inspection).toMatchObject({
      title: 'Pre-pour',
      location: 'Level 3',
      status: 'scheduled',
      missingRequiredItemIds: ['a', 'b'],
    });
    expect(inspection.id).toMatch(/^ins_|^[a-z]+_/);
    const shown = await getInspection(store, inspection.id);
    expect(shown?.pending).toBe(true);
    const [queued] = await store.listOutbox();
    expect(queued).toMatchObject({
      command: 'quality.startInspection',
      entityId: inspection.id,
      baseVersion: null,
      payload: { templateId: 'tpl_1', title: 'Pre-pour', location: 'Level 3' },
    });

    const answered = await saveAnswer(store, {
      inspection,
      version: null,
      itemId: 'a',
      answer: { result: 'pass' },
      mutationId: 'm-a',
      clientAt: at,
    });
    expect(answered.ok).toBe(true);
    const queue = await store.listOutbox();
    expect(queue.map((e) => e.command)).toEqual([
      'quality.startInspection',
      'quality.recordResponses',
    ]);
    expect(queue[1]!.dependsOn).toEqual(['m-start']);
  });

  it('refuses a checklist with no items', async () => {
    const { store } = await setup();
    const r = await startInspection(store, {
      template: template({ items: [] }),
      mutationId: 'm1',
      clientAt: at,
    });
    expect(r.ok).toBe(false);
    expect(await store.listOutbox()).toEqual([]);
  });
});

describe('photos on checklist items', () => {
  async function photoSetup() {
    const db = await nodeSqlDriver().open('ins-photo.db');
    await migrate(db);
    const store = new SqliteSyncStore(db, { moduleOf: () => 'quality' });
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
          projectId: 'prj_1',
          module: 'quality',
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
    const uploads = new UploadQueue(db, store, api, transfer);
    const photoItem = item('p', { responseType: 'photo', sort: 3 });
    await store.applyPull({
      changes: [
        {
          op: 'upsert',
          entityType: 'inspection',
          id: 'ins_1',
          version: 3,
          data: {
            ...pulled,
            items: [...pulled.items, photoItem],
            missingRequiredItemIds: ['a', 'b', 'p'],
          },
        },
      ],
      scopeKeys: ['project:prj_1:quality'],
      nextSince: '1',
    });
    const deps = { db, store, uploads };
    const taken = (itemId: string, photoId = 'pho_1', mutationId = 'm-photo') => ({
      inspection: undefined as never,
      itemId,
      photoId,
      mutationId,
      capture: { takenAt: at, timeZone: 'Australia/Brisbane' },
      file: {
        localUri: 'file:///p.jpg',
        thumbnailUri: 'file:///t.jpg',
        filename: 'p.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      },
      clientAt: at,
    });
    return { deps, store, uploads, taken };
  }

  it('shows the photo on a photo item at once and holds its command until the file is stored', async () => {
    const { deps, store, uploads, taken } = await photoSetup();
    const held = (await getInspection(store, 'ins_1'))!;
    const r = await attachItemPhoto(deps, { ...taken('p'), inspection: held.inspection });
    expect(r.ok).toBe(true);
    const after = (await getInspection(store, 'ins_1'))!;
    expect(after.pending).toBe(true);
    expect(after.inspection.responses[0]).toMatchObject({
      templateItemId: 'p',
      localPhotos: [{ photoId: 'pho_1', thumbnailUri: 'file:///t.jpg' }],
    });
    // The photo satisfies a required photo item.
    expect(after.inspection.missingRequiredItemIds).not.toContain('p');
    const [entry] = await store.listOutbox();
    expect(entry).toMatchObject({
      command: 'quality.attachItemPhoto',
      entityId: 'ins_1',
      status: 'held',
      payload: { templateItemId: 'p' },
    });
    expect((await uploads.list()).map((f) => [f.id, f.module])).toEqual([['pho_1', 'quality']]);

    // Once the file is stored, the command is released with its id.
    await uploads.drain();
    const [sent] = await store.listOutbox();
    expect(sent).toMatchObject({
      status: 'pending',
      payload: { templateItemId: 'p', fileId: 'fil_9' },
    });
  });

  it('needs an answer first on other kinds of item, and then keeps it', async () => {
    const { deps, store, taken } = await photoSetup();
    const first = (await getInspection(store, 'ins_1'))!;
    const refused = await attachItemPhoto(deps, { ...taken('a'), inspection: first.inspection });
    expect(refused).toMatchObject({ ok: false, code: 'inspection.invalid_answer' });
    expect(await store.listOutbox()).toEqual([]);

    await saveAnswer(store, {
      inspection: first.inspection,
      version: 3,
      itemId: 'a',
      answer: { result: 'fail' },
      mutationId: 'm-a',
      clientAt: at,
    });
    const answered = (await getInspection(store, 'ins_1'))!;
    expect(
      await attachItemPhoto(deps, { ...taken('a'), inspection: answered.inspection }),
    ).toMatchObject({ ok: true });
    const queue = await store.listOutbox();
    expect(queue.map((e) => e.command)).toEqual([
      'quality.recordResponses',
      'quality.attachItemPhoto',
    ]);
    expect(queue[1]!.dependsOn).toEqual(['m-a']);

    // A later answer to the same item keeps the photo that is still waiting.
    const withPhoto = (await getInspection(store, 'ins_1'))!;
    await saveAnswer(store, {
      inspection: withPhoto.inspection,
      version: 3,
      itemId: 'a',
      answer: { note: 'Cracked slab' },
      mutationId: 'm-note',
      clientAt: at,
    });
    const final = (await getInspection(store, 'ins_1'))!;
    expect(final.inspection.responses.find((x) => x.templateItemId === 'a')).toMatchObject({
      result: 'fail',
      note: 'Cracked slab',
      localPhotos: [{ photoId: 'pho_1' }],
    });
    const last = (await store.listOutbox()).at(-1)!;
    expect((last.payload as { responses: unknown[] }).responses).toEqual([
      expect.not.objectContaining({ fileIds: expect.anything() }),
    ]);
  });

  it('refuses a photo on a submitted inspection', async () => {
    const { deps, store, taken } = await photoSetup();
    const held = (await getInspection(store, 'ins_1'))!;
    const r = await attachItemPhoto(deps, {
      ...taken('p'),
      inspection: { ...held.inspection, status: 'submitted' },
    });
    expect(r).toMatchObject({ ok: false, code: 'inspection.not_editable' });
  });
});
