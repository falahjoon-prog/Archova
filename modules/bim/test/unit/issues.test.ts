import { describe, expect, it } from 'vitest';
import { canMove, cleanGuids } from '../../src/domain/issues';

describe('coordination issue lifecycle', () => {
  it('moves forward, and a finished issue can only be closed or reopened', () => {
    expect(canMove('open', 'in_progress')).toBe(true);
    expect(canMove('in_progress', 'resolved')).toBe(true);
    expect(canMove('resolved', 'closed')).toBe(true);
    expect(canMove('resolved', 'open')).toBe(true);
    expect(canMove('resolved', 'in_progress')).toBe(false);
    expect(canMove('closed', 'resolved')).toBe(false);
    expect(canMove('closed', 'open')).toBe(true);
  });

  it('cleans pasted element ids: trimmed, no blanks, no duplicates, order kept', () => {
    expect(
      cleanGuids([
        ' 3cUkl32yn9qRSPvBJVyWYp ',
        '',
        '2O2Fr$t4X7Zf8NOew3FNr2',
        '3cUkl32yn9qRSPvBJVyWYp',
      ]),
    ).toEqual(['3cUkl32yn9qRSPvBJVyWYp', '2O2Fr$t4X7Zf8NOew3FNr2']);
  });
});
