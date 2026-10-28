import { describe, expect, it } from 'vitest';
import type { DrawingCompareVisualInput, DrawingCompareVisualOutput } from '@archova/ai-prompts';
import type { TenantContext } from '@archova/kernel';
import { compareVisually } from '../../src/application/visual-compare';
import type { SheetChange, SheetLine } from '../../src/domain/drawing-compare';
import {
  changesNear,
  nearbyText,
  placeOf,
  plainSummary,
  planRegions,
  reviewVisual,
  sideBySide,
  type RegionPlan,
} from '../../src/domain/visual-compare';
import { diffRasters, type Raster } from '../../src/domain/visual-diff';

const W = 640;
const H = 480;
const paper = (): Raster => ({ width: W, height: H, data: new Uint8Array(W * H).fill(255) });
const fill = (r: Raster, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data[y * W + x] = 0;
  return r;
};
const sheet = (): Raster => {
  const r = paper();
  fill(r, 20, 20, W - 20, 23);
  fill(r, 20, 20, 23, H - 20);
  fill(r, 60, 250, 300, 253);
  return r;
};
const at = (text: string, px: number, py: number): SheetLine => ({ text, x: px / W, y: py / H });
const png = (b64: string) => Buffer.from(b64, 'base64').subarray(0, 8).toString('hex');
const PNG_SIGNATURE = '89504e470d0a1a0a';

describe('nearbyText and changesNear', () => {
  const box = { x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 };
  it('lists the sheet text within a margin of the box, nearest first, ignoring text far away', () => {
    const lines: SheetLine[] = [
      { text: 'FAR AWAY', x: 0.9, y: 0.9 },
      { text: 'NEXT TO IT', x: 0.52, y: 0.45 },
      { text: 'INSIDE', x: 0.45, y: 0.45 },
      { text: '  ', x: 0.45, y: 0.45 },
      { text: 'JUST OUTSIDE MARGIN', x: 0.6, y: 0.45 },
    ];
    expect(nearbyText(lines, box)).toEqual(['INSIDE', 'NEXT TO IT']);
    expect(nearbyText(lines, box, 0.04, 1)).toEqual(['INSIDE']);
    expect(nearbyText([{ text: 'x'.repeat(500), x: 0.45, y: 0.45 }], box)[0]).toHaveLength(200);
  });

  it('finds the text changes that sit in or beside the box', () => {
    const change = (id: string, x: number, y: number) =>
      ({ id, kind: 'changed', before: 'a', after: 'b', titleBlock: false, x, y }) as SheetChange;
    expect(
      changesNear([change('c1', 0.45, 0.45), change('c2', 0.8, 0.8), change('c3', 0.53, 0.5)], box),
    ).toEqual(['c1', 'c3']);
  });
});

describe('pictures and places', () => {
  it('puts the old picture on the left and the new on the right with a bar between', () => {
    const a: Raster = { width: 2, height: 2, data: Uint8Array.of(0, 1, 2, 3) };
    const b: Raster = { width: 2, height: 2, data: Uint8Array.of(10, 11, 12, 13) };
    const s = sideBySide(a, b, 3);
    expect([s.width, s.height]).toEqual([7, 2]);
    expect(Array.from(s.data)).toEqual([0, 1, 128, 128, 128, 10, 11, 2, 3, 128, 128, 128, 12, 13]);
  });

  it('rounds a place outwards to whole percent', () => {
    expect(placeOf({ x0: 0.104, y0: 0.2, x1: 0.255, y1: 1 })).toEqual({
      x0: 10,
      y0: 20,
      x1: 26,
      y1: 100,
    });
  });
});

describe('planRegions and reviewVisual', () => {
  const before = sheet();
  const after = sheet();
  fill(after, 100, 100, 160, 140); // added
  fill(before, 400, 300, 450, 360); // removed
  const diff = diffRasters(before, after);
  const plans: RegionPlan[] = planRegions(diff, after, {
    before: [at('D07  920 x 2040', 400, 370)],
    after: [at('WC-02', 110, 150), at('BASIN 600', 120, 90)],
    changes: [
      {
        id: 'c1',
        kind: 'added',
        before: null,
        after: 'WC-02',
        titleBlock: false,
        x: 110 / W,
        y: 150 / H,
      },
    ],
  });
  const added = plans.find((p) => p.region.kind === 'added')!;
  const removed = plans.find((p) => p.region.kind === 'removed')!;
  const said = (id: string, summary: string): DrawingCompareVisualOutput['regions'][number] => ({
    id,
    summary,
    what: 'fixture_or_services',
    cloud: 'no',
  });

  it('pairs each region with its picture, nearby text and text changes', () => {
    expect(plans).toHaveLength(2);
    expect(added.afterText).toEqual(['WC-02', 'BASIN 600']);
    expect(added.beforeText).toEqual([]);
    expect(added.changeIds).toEqual(['c1']);
    expect(removed.beforeText).toEqual(['D07  920 x 2040']);
    expect(removed.changeIds).toEqual([]);
    // Same box cut from both sheets: the picture is twice as wide as one side plus the bar.
    const side = (added.tile.width - 6) / 2;
    expect(Number.isInteger(side)).toBe(true);
    expect(added.tile.height).toBeLessThanOrEqual(512);
  });

  it('keeps a description whose numbers come from the text near the region', () => {
    const r = reviewVisual(
      {
        regions: [
          said(added.region.id, 'A new fixture was drawn beside the basin 600 note.'),
          said(removed.region.id, 'The door tagged D07 920 x 2040 was removed.'),
        ],
      },
      plans,
    );
    expect(r.dropped).toBe(0);
    expect(r.regions.map((x) => [x.described, x.what, x.cloud])).toEqual(
      plans.map(() => [true, 'fixture_or_services', 'no']),
    );
    expect(r.regions[0]!.changeIds).toEqual(plans[0] === added ? ['c1'] : []);
  });

  it('replaces a description that states a number the nearby text lacks, and says what it removed', () => {
    const r = reviewVisual(
      {
        regions: [
          said(added.region.id, 'A 450 mm basin was added.'),
          said(removed.region.id, 'A door was removed.'),
        ],
      },
      plans,
    );
    expect(r.dropped).toBe(1);
    const a = r.regions.find((x) => x.id === added.region.id)!;
    expect(a).toMatchObject({
      summary: plainSummary('added'),
      described: false,
      what: null,
      cloud: null,
    });
    expect(r.regions.find((x) => x.id === removed.region.id)!.described).toBe(true);
  });

  it('counts a whole number only against whole numbers: 2 is not found inside 2040', () => {
    const r = reviewVisual(
      { regions: [said(removed.region.id, 'Two doors, 2 of them, went.')] },
      plans,
    );
    expect(r.regions.find((x) => x.id === removed.region.id)!.described).toBe(false);
  });

  it('lists every region found, in order, even when Nova skips one or answers for a region we never sent', () => {
    const r = reviewVisual(
      {
        regions: [
          said('r9', 'Something on a part of the sheet we never showed.'),
          said(added.region.id, 'New lines beside the basin.'),
          said(added.region.id, 'A repeat.'),
        ],
      },
      plans,
    );
    expect(r.regions.map((x) => x.id)).toEqual(plans.map((p) => p.region.id));
    expect(r.regions.filter((x) => x.described)).toHaveLength(1);
    expect(r.dropped).toBe(2);
    const skipped = r.regions.find((x) => x.id === removed.region.id)!;
    expect(skipped).toMatchObject({ summary: plainSummary('removed'), described: false });
  });
});

describe('compareVisually', () => {
  const ctx = {} as TenantContext;
  const text = {
    before: [] as SheetLine[],
    after: [at('WC-02', 110, 150), at('DIM 2700', 120, 90)],
    changes: [] as SheetChange[],
  };
  const req = (rasters: { before: Raster; after: Raster }) => ({
    projectId: 'prj_1',
    sheet: { label: 'A-211 Level 2 Floor Plan', fromRev: 'B', toRev: 'C' },
    rasters,
    text,
  });
  /** A gateway that records the input it was given and answers with `reply`. */
  function gateway(
    reply: (i: DrawingCompareVisualInput) => DrawingCompareVisualOutput | 'refused',
  ) {
    const inputs: DrawingCompareVisualInput[] = [];
    return {
      inputs,
      runTask: (async (_ctx: unknown, _prompt: unknown, input: DrawingCompareVisualInput) => {
        inputs.push(input);
        const out = reply(input);
        return out === 'refused'
          ? { runId: 'run_1', status: 'refused', credits: 0, costMicros: 0 }
          : { runId: 'run_1', status: 'ok', output: out };
      }) as never,
    };
  }
  const changedSheet = () => {
    const after = sheet();
    fill(after, 100, 100, 160, 140);
    return { before: sheet(), after };
  };

  it('asks once for all regions, with a PNG of each, and returns the reviewed descriptions', async () => {
    const g = gateway((i) => ({
      regions: i.regions.map((r) => ({
        id: r.id,
        summary: 'New lines beside the 2700 dimension.',
        what: 'dimension_or_note' as const,
        cloud: 'yes' as const,
      })),
    }));
    const r = await compareVisually({ runTask: g.runTask }, ctx, req(changedSheet()));
    expect(g.inputs).toHaveLength(1);
    const input = g.inputs[0]!;
    expect(input).toMatchObject({
      sheet: 'A-211 Level 2 Floor Plan',
      fromRev: 'B',
      toRev: 'C',
      truncated: false,
    });
    expect(input.regions).toHaveLength(1);
    expect(input.regions[0]!.afterText).toEqual(['WC-02', 'DIM 2700']);
    expect(input.regions[0]!.image.mime).toBe('image/png');
    expect(png(input.regions[0]!.image.base64)).toBe(PNG_SIGNATURE);
    expect(r.complete).toBe(true);
    expect(r.runId).toBe('run_1');
    expect(r.payload).toMatchObject({ reliable: true, reason: null, truncated: false, dropped: 0 });
    expect(r.payload.regions).toHaveLength(1);
    expect(r.payload.regions[0]).toMatchObject({
      id: 'r1',
      kind: 'added',
      described: true,
      what: 'dimension_or_note',
      cloud: 'yes',
    });
  });

  it('makes no model call when no lines changed', async () => {
    const g = gateway(() => 'refused');
    const r = await compareVisually(
      { runTask: g.runTask },
      ctx,
      req({ before: sheet(), after: sheet() }),
    );
    expect(g.inputs).toHaveLength(0);
    expect(r).toMatchObject({ runId: null, complete: true });
    expect(r.payload).toMatchObject({ reliable: true, regions: [] });
  });

  it('makes no model call when the sheets are too different to compare, and says why', async () => {
    const g = gateway(() => 'refused');
    const redrawn = paper();
    for (let y = 30; y < H - 30; y += 20) fill(redrawn, 30, y, W - 30, y + 4);
    const r = await compareVisually(
      { runTask: g.runTask },
      ctx,
      req({ before: sheet(), after: redrawn }),
    );
    expect(g.inputs).toHaveLength(0);
    expect(r.payload).toMatchObject({ reliable: false, reason: 'too_different', regions: [] });
    expect(r.complete).toBe(true);
  });

  it('still lists the regions, undescribed, when Nova refuses, and says the result is not complete', async () => {
    const g = gateway(() => 'refused');
    const r = await compareVisually({ runTask: g.runTask }, ctx, req(changedSheet()));
    expect(r.complete).toBe(false);
    expect(r.runId).toBeNull();
    expect(r.payload.regions).toHaveLength(1);
    expect(r.payload.regions[0]).toMatchObject({
      kind: 'added',
      summary: plainSummary('added'),
      described: false,
      cloud: null,
    });
  });
});
