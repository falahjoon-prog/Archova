import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { createDrawingsSyncSource } from '../../src/api/drawings-sync';

const U = (n: number) => `0191a5b0-0000-7000-8000-00000000000${n}`;
const date = new Date('2026-11-05T01:00:00Z');
const revision = {
  id: U(3),
  projectId: U(1),
  orgId: U(9),
  setId: U(4),
  sheetId: U(2),
  sheetNumber: 'A-101',
  title: 'Ground floor',
  discipline: 'Architectural',
  rev: 'C',
  issuedFor: 'for_construction',
  fileId: U(5),
  pageIndex: 0,
  status: 'current',
  drawingDate: null,
  publishReason: null,
  publishedAt: date,
  supersededById: null,
  successor: null,
  version: 4,
};
const sheet = {
  id: U(2),
  projectId: U(1),
  sheetNumber: 'A-101',
  title: 'Ground floor',
  discipline: 'Architectural',
  area: null,
  currentRevisionId: U(3),
  updatedAt: date,
  version: 7,
};

function source() {
  const drawings = {
    sheetsAmong: vi.fn(async () => [{ sheet, current: revision }]),
    publishedRevisionsAmong: vi.fn(async () => [revision]),
  };
  return { drawings, source: createDrawingsSyncSource(drawings as never) };
}
const scope = {} as TenantScope;

describe('drawings sync source', () => {
  it('serves sheets with their current revision, filed under the project', async () => {
    const { source: s } = source();
    const out = await s.load(scope, { projectId: U(1), entityType: 'drawing_sheet', ids: [U(2)] });
    const rec = out.get(U(2))!;
    expect(rec.version).toBe(7);
    expect(rec.data).toMatchObject({
      sheetNumber: 'A-101',
      projectId: expect.stringMatching(/^prj_/),
    });
    expect(rec.data.currentRevision).toMatchObject({ rev: 'C', status: 'current' });
  });

  it('serves published revisions with the file the phone caches', async () => {
    const { source: s } = source();
    const out = await s.load(scope, {
      projectId: U(1),
      entityType: 'drawing_revision',
      ids: [U(3)],
    });
    expect(out.get(U(3))!.data).toMatchObject({ rev: 'C', fileId: expect.any(String) });
  });

  it('serves nothing for other entity types or without a project, and names public ids', async () => {
    const { source: s, drawings } = source();
    expect((await s.load(scope, { projectId: U(1), entityType: 'markup', ids: [U(2)] })).size).toBe(
      0,
    );
    expect(
      (await s.load(scope, { projectId: null, entityType: 'drawing_sheet', ids: [U(2)] })).size,
    ).toBe(0);
    expect(drawings.sheetsAmong).not.toHaveBeenCalled();
    expect(s.module).toBe('drawings');
    expect(s.permission).toBe('documents.drawings.read');
    expect(s.publicId('drawing_sheet', U(2))).toMatch(/^dsh_|^drs_|^[a-z]+_/);
    expect(s.publicId('drawing_revision', U(3))).not.toBe(s.publicId('drawing_sheet', U(3)));
  });
});
