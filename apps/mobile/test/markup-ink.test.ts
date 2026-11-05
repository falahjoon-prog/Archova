import { describe, expect, it, vi } from 'vitest';
import {
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
