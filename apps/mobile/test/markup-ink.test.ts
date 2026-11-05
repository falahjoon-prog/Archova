import { describe, expect, it, vi } from 'vitest';
import type { Markup } from '@archova/contracts';
import {
  canChangeMarkup,
  changeMarkup,
  createInk,
  listRevisionMarkups,
  MAX_POINTS_PER_STROKE,
  MAX_SHAPES,
  savePenMarkup,
} from '../features/drawings';
import { migrate, SqliteSyncStore } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

vi.mock('../features/drawings/screens/DrawingRegisterScreen', () => ({}));
vi.mock('../features/drawings/screens/DrawingViewerScreen', () => ({}));

const counter = () => {
  let n = 0;
  return () => `s${++n}`;
};

describe('createInk', () => {
  it('turns a drag into a pen stroke', () => {
    const ink = createInk(counter());
    ink.begin({ x: 0.1, y: 0.1 });
    ink.move({ x: 0.2, y: 0.2 });
    ink.move({ x: 0.3, y: 0.2 });
    expect(ink.live).toHaveLength(3);
    ink.end();
    expect(ink.live).toEqual([]);
    expect(ink.strokes).toEqual([
      expect.objectContaining({ id: 's1', kind: 'pen', points: expect.any(Array) }),
    ]);
    expect(ink.strokes[0]!.points).toHaveLength(3);
  });

  it('ignores a tap and tiny movements', () => {
    const ink = createInk(counter());
    ink.begin({ x: 0.5, y: 0.5 });
    ink.move({ x: 0.5001, y: 0.5 });
    ink.end();
    expect(ink.strokes).toEqual([]);
  });

  it('drops a stroke that a second finger cancelled', () => {
    const ink = createInk(counter());
    ink.begin({ x: 0.1, y: 0.1 });
    ink.move({ x: 0.4, y: 0.4 });
    ink.cancel();
    ink.end();
    expect(ink.strokes).toEqual([]);
  });

  it('undoes the last stroke and clears all', () => {
    const ink = createInk(counter());
    for (const x of [0.1, 0.5]) {
      ink.begin({ x, y: 0.1 });
      ink.move({ x, y: 0.4 });
      ink.end();
    }
    ink.undo();
    expect(ink.strokes.map((s) => s.id)).toEqual(['s1']);
    ink.clear();
    expect(ink.strokes).toEqual([]);
  });

  it('keeps within the server limits', () => {
    const ink = createInk(counter());
    ink.begin({ x: 0, y: 0 });
    for (let i = 1; i < MAX_POINTS_PER_STROKE + 50; i++)
      ink.move({ x: (i % 2) * 0.5, y: i / 20000 + 0.01 * (i % 2) });
    ink.end();
    expect(ink.strokes[0]!.points.length).toBeLessThanOrEqual(MAX_POINTS_PER_STROKE);
    expect(MAX_SHAPES).toBe(2000);
  });
});

describe('savePenMarkup', () => {
  async function setup() {
    const db = await nodeSqlDriver().open('markups.db');
    await migrate(db);
    return new SqliteSyncStore(db, { moduleOf: () => 'drawings' });
  }
  const draw = () => {
    const ink = createInk(counter());
    ink.begin({ x: 0.1, y: 0.1 });
    ink.move({ x: 0.3, y: 0.3 });
    ink.end();
    return ink;
  };

  it('keeps a private markup on the device and queues it under the same id', async () => {
    const store = await setup();
    const { markupId } = await savePenMarkup(store, {
      projectId: 'prj_1',
      revisionId: 'drv_1',
      shapes: draw().strokes,
      mutationId: 'm1',
      clientAt: '2026-11-05T01:00:00.000Z',
    });
    expect(markupId).toMatch(/^mkp?_|^[a-z]+_/);
    const mine = await listRevisionMarkups(store, 'prj_1', 'drv_1');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: markupId, visibility: 'private', revisionId: 'drv_1' });
    expect(await listRevisionMarkups(store, 'prj_1', 'drv_other')).toHaveLength(0);
    const [queued] = await store.listOutbox();
    expect(queued).toMatchObject({
      command: 'drawings.createMarkup',
      entityId: markupId,
      baseVersion: null,
      payload: {
        revisionId: 'drv_1',
        visibility: 'private',
        shapes: [expect.objectContaining({ kind: 'pen' })],
      },
    });
  });

  it('refuses an empty drawing', async () => {
    const store = await setup();
    await expect(
      savePenMarkup(store, {
        projectId: 'prj_1',
        revisionId: 'drv_1',
        shapes: [],
        mutationId: 'm1',
        clientAt: '2026-11-05T01:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});

describe('changeMarkup', () => {
  async function saved(strokes = 2) {
    const db = await nodeSqlDriver().open('markup-change.db');
    await migrate(db);
    const store = new SqliteSyncStore(db, { moduleOf: () => 'drawings' });
    const ink = createInk(counter());
    for (let i = 0; i < strokes; i++) {
      ink.begin({ x: 0.1, y: 0.1 + i * 0.1 });
      ink.move({ x: 0.4, y: 0.4 });
      ink.end();
    }
    const { markupId } = await savePenMarkup(store, {
      projectId: 'prj_1',
      revisionId: 'drv_1',
      shapes: ink.strokes,
      mutationId: 'm1',
      clientAt: '2026-11-05T01:00:00.000Z',
    });
    return { store, markupId, ink };
  }
  const at = '2026-11-05T02:00:00.000Z';

  it('queues an edit behind the markup still waiting to be created', async () => {
    const { store, markupId, ink } = await saved();
    const r = await changeMarkup(store, {
      markupId,
      change: { kind: 'shapes', shapes: ink.strokes.slice(0, 1) },
      mutationId: 'm2',
      clientAt: at,
    });
    expect(r).toEqual({ ok: true });
    const [mine] = await listRevisionMarkups(store, 'prj_1', 'drv_1');
    expect(mine!.shapes).toHaveLength(1);
    const queue = await store.listOutbox();
    expect(queue.map((e) => e.command)).toEqual(['drawings.createMarkup', 'drawings.updateMarkup']);
    expect(queue[1]).toMatchObject({ baseVersion: null, dependsOn: ['m1'] });
  });

  it('sends the version the device last saw once the markup is confirmed', async () => {
    const { store, markupId } = await saved();
    await store.recordPushResults([{ mutationId: 'm1', status: 'applied', version: 1 }]);
    await changeMarkup(store, {
      markupId,
      change: { kind: 'publish' },
      mutationId: 'm2',
      clientAt: at,
    });
    const [queued] = await store.listOutbox();
    expect(queued).toMatchObject({
      command: 'drawings.updateMarkup',
      baseVersion: 1,
      payload: { visibility: 'project' },
      dependsOn: [],
    });
    const [mine] = await listRevisionMarkups(store, 'prj_1', 'drv_1');
    expect(mine).toMatchObject({ visibility: 'project', publishedAt: at });
    // Published is the record: no further changes.
    expect(
      await changeMarkup(store, {
        markupId,
        change: { kind: 'delete' },
        mutationId: 'm3',
        clientAt: at,
      }),
    ).toEqual({ ok: false, reason: 'published' });
  });

  it('hides a deleted markup at once and queues the delete', async () => {
    const { store, markupId } = await saved();
    await store.recordPushResults([{ mutationId: 'm1', status: 'applied', version: 1 }]);
    expect(
      await changeMarkup(store, {
        markupId,
        change: { kind: 'delete' },
        mutationId: 'm2',
        clientAt: at,
      }),
    ).toEqual({ ok: true });
    expect(await listRevisionMarkups(store, 'prj_1', 'drv_1')).toEqual([]);
    expect((await store.listOutbox())[0]).toMatchObject({
      command: 'drawings.deleteMarkup',
      baseVersion: 1,
    });
    expect(
      await changeMarkup(store, {
        markupId,
        change: { kind: 'delete' },
        mutationId: 'm3',
        clientAt: at,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses an empty edit and an unknown markup', async () => {
    const { store, markupId } = await saved();
    expect(
      await changeMarkup(store, {
        markupId,
        change: { kind: 'shapes', shapes: [] },
        mutationId: 'm2',
        clientAt: at,
      }),
    ).toEqual({ ok: false, reason: 'no_shapes' });
    expect(
      await changeMarkup(store, {
        markupId: 'nope',
        change: { kind: 'delete' },
        mutationId: 'm3',
        clientAt: at,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('canChangeMarkup', () => {
  const base = { ownerId: 'usr_1', visibility: 'company' } as unknown as Markup;
  it('allows the author until it is published, never others or published ones', () => {
    expect(canChangeMarkup({ ...base, visibility: 'private' }, null)).toBe(true);
    expect(canChangeMarkup({ ...base, ownerId: '' }, null)).toBe(true);
    expect(canChangeMarkup(base, 'usr_1')).toBe(true);
    expect(canChangeMarkup(base, 'usr_2')).toBe(false);
    expect(canChangeMarkup({ ...base, visibility: 'project' }, 'usr_1')).toBe(false);
  });
});
