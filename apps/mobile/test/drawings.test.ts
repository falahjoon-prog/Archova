import { describe, expect, it, vi } from 'vitest';
import type { DrawingSheet as Sheet } from '@archova/contracts';
import { drawingPdfUrl, pdfPageUrl, registerRows, saveAllSummary } from '../features/drawings';

vi.mock('../features/drawings/screens/DrawingRegisterScreen', () => ({}));
vi.mock('../features/drawings/screens/DrawingViewerScreen', () => ({}));

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

  it('sorts sheets by number and marks the ones saved on the device', () => {
    const rev = (id: string) => ({ id, rev: 'A', issuedFor: null }) as Sheet['currentRevision'];
    const rows = registerRows(
      [
        sheet({ id: 'b', sheetNumber: 'A-110', currentRevision: rev('r2') }),
        sheet({ id: 'a', sheetNumber: 'A-9', currentRevision: rev('r1') }),
      ],
      new Set(['r2']),
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]!.subtitle).not.toContain('Saved offline');
    expect(rows[1]!.subtitle).toContain('Saved offline');
  });

  it('says so when a sheet has no current revision', () => {
    const [row] = registerRows([sheet({ discipline: null })]);
    expect(row).toMatchObject({ subtitle: 'No current revision', hasRevision: false });
  });
});

describe('sheet PDF fallback', () => {
  it("opens the sheet's page (1-based in the PDF fragment)", () => {
    expect(pdfPageUrl('https://files.test/a.pdf?sig=1', 0)).toBe(
      'https://files.test/a.pdf?sig=1#page=1',
    );
    expect(pdfPageUrl('https://files.test/a.pdf#old', 4)).toBe('https://files.test/a.pdf#page=5');
    expect(pdfPageUrl('https://files.test/a.pdf', -2)).toBe('https://files.test/a.pdf#page=1');
  });

  it('fetches a fresh download link for the revision file', async () => {
    const GET = vi.fn(async () => ({
      data: { url: 'https://files.test/x.pdf', expiresAt: '2026-10-30T06:00:00Z' },
      response: new Response(null, { status: 200 }),
    }));
    const url = await drawingPdfUrl({ GET } as never, 'org1', 'fil_1', 2);
    expect(url).toBe('https://files.test/x.pdf#page=3');
    expect(GET).toHaveBeenCalledWith('/v1/orgs/{orgId}/files/{fileId}/download', {
      params: { path: { orgId: 'org1', fileId: 'fil_1' } },
    });
  });
});

describe('saveAllSummary', () => {
  it('says what happened in plain words', () => {
    expect(saveAllSummary({ saved: 0, alreadySaved: 0, failed: 0, stoppedBecause: null })).toBe(
      'Nothing to save.',
    );
    expect(saveAllSummary({ saved: 2, alreadySaved: 1, failed: 0, stoppedBecause: 'full' })).toBe(
      '2 saved. 1 already on this device. Stopped because the drawing storage is full.',
    );
  });
});
