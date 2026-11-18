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

  it('asks for the last week and for tracked documents with the matching filters', async () => {
    fake.on('GET', `${P}/documents`, () => ({
      data: [{ ...doc, tracked: true }],
      nextCursor: null,
    }));
    const api = createDocumentsApi('org_1');
    const tracked = await api.listDocuments('prj_1', null, 'tracked');
    expect(tracked[0]!.tracked).toBe(true);
    await api.listDocuments('prj_1', null, 'week');
    const [a, b] = fake.callsTo('GET', `${P}/documents`).map((c) => c.init.params?.query);
    expect(a).toMatchObject({ tracked: 'true' });
    expect(b).toHaveProperty('createdSince');
  });

  it('deletes with the version, lists the bin and restores', async () => {
    fake.on('DELETE', `${P}/documents/{documentId}`, () => undefined);
    fake.on('GET', `${P}/documents/bin`, () => ({
      data: [{ ...doc, deletedAt: '2026-11-01T00:00:00Z' }],
      nextCursor: null,
    }));
    fake.on('POST', `${P}/documents/{documentId}/restore`, () => ({
      document: doc,
      revisions: [],
    }));
    const api = createDocumentsApi('org_1');
    await api.deleteDocument('prj_1', { id: 'doc_geo', version: 2 });
    expect(fake.callsTo('DELETE', `${P}/documents/{documentId}`)[0]!.init.params?.header).toEqual({
      'If-Match': '"2"',
    });
    expect((await api.listBin('prj_1'))[0]!.deletedAt).toBe('2026-11-01T00:00:00Z');
    expect((await api.restoreDocument('prj_1', 'doc_geo')).id).toBe('doc_geo');
  });
});
