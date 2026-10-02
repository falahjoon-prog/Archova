import { beforeEach, describe, expect, it } from 'vitest';
import { documentsSource, resetDocumentsPreview } from '../data/source';

beforeEach(() => resetDocumentsPreview());

describe('documents preview source', () => {
  it('supersedes the current revision when a new one is added, and rejects a duplicate', async () => {
    const doc = await documentsSource.addRevision(
      'p',
      'doc_geo',
      { rev: 'B', file: new File(['%PDF'], 'geo-B.pdf'), notes: '' },
      { name: 'Test' },
    );
    expect(doc.currentRev).toBe('B');
    const revs = await documentsSource.listRevisions('p', 'doc_geo');
    expect(revs.map((r) => [r.rev, r.status])).toEqual([
      ['B', 'current'],
      ['A', 'superseded'],
    ]);
    await expect(
      documentsSource.addRevision(
        'p',
        'doc_geo',
        { rev: 'B', file: new File(['%PDF'], 'x.pdf'), notes: '' },
        { name: 'Test' },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('filters by folder', async () => {
    const certs = await documentsSource.listDocuments('p', 'fld_cert');
    expect(certs.map((d) => d.title)).toEqual(['Construction certificate']);
  });
});
