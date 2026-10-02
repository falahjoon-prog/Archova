import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/uploads', () => ({ uploadFile, fileDownloadUrl: vi.fn() }));

const { createDocumentsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}';

const rev = (id: string, r: string, status: 'current' | 'superseded') => ({
  id,
  documentId: 'doc_geo',
  rev: r,
  fileId: `fil_${id}`,
  status,
  issuedFor: null,
  issuedDate: null,
  notes: null,
  createdAt: '2026-09-01T00:00:00Z',
  createdBy: 'usr_1',
});

const doc = {
  id: 'doc_geo',
  projectId: 'prj_1',
  folderId: 'fld_reports',
  title: 'Geotechnical report',
  docNumber: 'GEO-01',
  discipline: null,
  docType: null,
  status: 'approved',
  currentRevision: rev('rev_b', 'B', 'current'),
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  version: 2,
};

beforeEach(() => {
  fake.reset();
  uploadFile.mockReset();
});

describe('documents API source', () => {
  it('reads every page of a folder and maps the current revision', async () => {
    fake.on('GET', `${P}/documents`, (init) =>
      init.params?.query?.cursor
        ? { data: [{ ...doc, id: 'doc_b', title: 'Arborist report' }], nextCursor: null }
        : { data: [doc], nextCursor: 'c2' },
    );
    const docs = await createDocumentsApi('org_1').listDocuments('prj_1', 'fld_reports');
    expect(docs.map((d) => [d.title, d.currentRev])).toEqual([
      ['Arborist report', 'B'],
      ['Geotechnical report', 'B'],
    ]);
    expect(fake.callsTo('GET', `${P}/documents`)[0]!.init.params?.query).toMatchObject({
      folderId: 'fld_reports',
    });
  });

  it('lists revisions with their file names', async () => {
    fake.on('GET', `${P}/documents/{documentId}`, () => ({
      document: doc,
      revisions: [rev('rev_b', 'B', 'current'), rev('rev_a', 'A', 'superseded')],
    }));
    fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', (init) => ({
      filename: `${init.params?.path?.fileId}.pdf`,
    }));
    const revisions = await createDocumentsApi('org_1').listRevisions('prj_1', 'doc_geo');
    expect(revisions.map((r) => [r.rev, r.status, r.fileName, r.fileId])).toEqual([
      ['B', 'current', 'fil_rev_b.pdf', 'fil_rev_b'],
      ['A', 'superseded', 'fil_rev_a.pdf', 'fil_rev_a'],
    ]);
  });

  it('uploads the file, then adds the revision with its file id', async () => {
    uploadFile.mockResolvedValue({ id: 'fil_new' });
    fake.on('POST', `${P}/documents/{documentId}/revisions`, () => ({
      document: { ...doc, currentRevision: rev('rev_c', 'C', 'current') },
      revisions: [],
    }));
    const file = new File(['%PDF'], 'geo-C.pdf');
    const updated = await createDocumentsApi('org_1').addRevision(
      'prj_1',
      'doc_geo',
      { rev: 'C', file, notes: '' },
      { name: 'Test' },
    );
    expect(uploadFile).toHaveBeenCalledWith('org_1', {
      file,
      projectId: 'prj_1',
      module: 'documents',
    });
    expect(fake.callsTo('POST', `${P}/documents/{documentId}/revisions`)[0]!.init.body).toEqual({
      rev: 'C',
      fileId: 'fil_new',
    });
    expect(updated.currentRev).toBe('C');
  });
});
