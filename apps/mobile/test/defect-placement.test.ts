import { describe, expect, it, vi } from 'vitest';
import { parsePlacement } from '../features/defects';

vi.mock('../features/defects/screens/DefectListScreen', () => ({}));
vi.mock('../features/defects/screens/NewDefectScreen', () => ({}));
vi.mock('../features/defects/screens/DefectDetailScreen', () => ({}));

const ok = { sheetId: 'sht_1', drawingRevisionId: 'rev_1', pinX: '0.25', pinY: '0.5' };

describe('parsePlacement', () => {
  it('reads a pin from the route', () => {
    expect(parsePlacement(ok)).toEqual({
      sheetId: 'sht_1',
      drawingRevisionId: 'rev_1',
      pinX: 0.25,
      pinY: 0.5,
    });
  });

  it('accepts the edges of the sheet', () => {
    expect(parsePlacement({ ...ok, pinX: '0', pinY: '1' })).toMatchObject({ pinX: 0, pinY: 1 });
  });

  it('returns null when anything is missing, empty, or out of range', () => {
    expect(parsePlacement({})).toBeNull();
    expect(parsePlacement({ ...ok, sheetId: undefined })).toBeNull();
    expect(parsePlacement({ ...ok, pinX: '' })).toBeNull();
    expect(parsePlacement({ ...ok, pinX: '1.2' })).toBeNull();
    expect(parsePlacement({ ...ok, pinY: '-0.1' })).toBeNull();
    expect(parsePlacement({ ...ok, pinY: 'abc' })).toBeNull();
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parsePlacement({ ...ok, pinX: ['0.1', '0.9'] })?.pinX).toBe(0.1);
  });
});
