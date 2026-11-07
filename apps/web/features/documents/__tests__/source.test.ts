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

  it('tracks, deletes to the bin and restores', async () => {
    await documentsSource.setTracked('p', 'doc_geo', true);
    expect((await documentsSource.listDocuments('p', null, 'tracked')).map((d) => d.id)).toEqual([
      'doc_geo',
    ]);
    await documentsSource.deleteDocument('p', { id: 'doc_geo', version: 1 });
    expect(await documentsSource.listDocuments('p', null, 'tracked')).toEqual([]);
    expect((await documentsSource.listBin('p')).map((d) => d.id)).toEqual(['doc_geo']);
    await documentsSource.restoreDocument('p', 'doc_geo');
    expect(await documentsSource.listBin('p')).toEqual([]);
  });
});
