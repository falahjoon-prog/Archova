import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/inspections/screens/InspectionListScreen', () => ({}));
vi.mock('../features/inspections/screens/InspectionScreen', () => ({}));
import { migrate, SqliteSyncStore } from '../lib/db';
import {
  getInspection,
  listInspections,
  saveAnswer,
  submitInspection,
  type LocalInspection,
} from '../features/inspections';
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
