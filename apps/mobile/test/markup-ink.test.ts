import { describe, expect, it, vi } from 'vitest';
import {
  createInk,
  createPenMarkup,
  MAX_POINTS_PER_STROKE,
  MAX_SHAPES,
} from '../features/drawings';

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

describe('createPenMarkup', () => {
  it('saves strokes as a private markup with an idempotency key', async () => {
    const POST = vi.fn(async () => ({
      data: { id: 'mk_1', shapes: [] },
      response: new Response(null, { status: 201 }),
    }));
    const ink = createInk(counter());
    ink.begin({ x: 0.1, y: 0.1 });
    ink.move({ x: 0.3, y: 0.3 });
    ink.end();
    await createPenMarkup(
      { POST } as never,
      { orgId: 'o', projectId: 'p', revisionId: 'r' },
      ink.strokes,
      'key-1',
    );
    expect(POST).toHaveBeenCalledWith(
      expect.stringContaining('/markups'),
      expect.objectContaining({
        params: {
          path: { orgId: 'o', projectId: 'p', drawingRevisionId: 'r' },
          header: { 'Idempotency-Key': 'key-1' },
        },
        body: { visibility: 'private', shapes: [expect.objectContaining({ kind: 'pen' })] },
      }),
    );
  });
});
