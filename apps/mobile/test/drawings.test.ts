import { describe, expect, it } from 'vitest';
import type { DrawingSheet as Sheet } from '@archova/contracts';
import { registerRows } from '../features/drawings';

const sheet = (over: Partial<Sheet>): Sheet => ({
  id: 's1',
  projectId: 'p1',
  sheetNumber: 'A-101',
  title: 'Ground floor plan',
  discipline: 'A',
  area: null,
  currentRevision: null,
  updatedAt: '2026-10-01T00:00:00Z',
  version: 1,
  ...over,
});

describe('registerRows', () => {
  it('shows number, title, discipline and revision', () => {
    const rev = { rev: 'C', issuedFor: 'for_construction' } as Sheet['currentRevision'];
    const [row] = registerRows([sheet({ currentRevision: rev })]);
    expect(row).toMatchObject({
      title: 'A-101 · Ground floor plan',
      subtitle: 'A · Rev C · For construction',
      hasRevision: true,
    });
  });

  it('says so when a sheet has no current revision', () => {
    const [row] = registerRows([sheet({ discipline: null })]);
    expect(row).toMatchObject({ subtitle: 'No current revision', hasRevision: false });
  });
});
