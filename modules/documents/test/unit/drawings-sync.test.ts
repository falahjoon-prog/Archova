import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { encodeId } from '@archova/domain';
import { AppError } from '@archova/kernel';
import { createDrawingsSyncSource, createMarkupCommand } from '../../src/api/drawings-sync';

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

const markup = {
  id: U(6),
  projectId: U(1),
  revisionId: U(3),
  ownerId: U(7),
  ownerCompanyId: null,
  visibility: 'private',
  shapes: [{ id: 's1', kind: 'pen', points: [{ x: 0.1, y: 0.2 }], strokeWidth: 3 }],
  copiedFromId: null,
  needsLocationCheck: false,
  publishedAt: null,
  createdAt: date,
  updatedAt: date,
  version: 1,
};

function source() {
  const drawings = {
    sheetsAmong: vi.fn(async () => [{ sheet, current: revision }]),
    publishedRevisionsAmong: vi.fn(async () => [revision]),
  };
  const markups = { visibleAmong: vi.fn(async () => [markup]) };
  return {
    drawings,
    markups,
    source: createDrawingsSyncSource(drawings as never, markups as never),
  };
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

describe('markups in the drawings sync source', () => {
  it('serves the markups the caller may see, with the markup public id', async () => {
    const { source: s, markups } = source();
    const out = await s.load(scope, { projectId: U(1), entityType: 'drawing_markup', ids: [U(6)] });
    expect(markups.visibleAmong).toHaveBeenCalledWith(scope, U(1), [U(6)]);
    expect(out.get(U(6))!.data).toMatchObject({
      visibility: 'private',
      revisionId: encodeId('drawingRevision', U(3)),
    });
    expect(s.publicId('drawing_markup', U(6))).toBe(encodeId('markup', U(6)));
  });
});

describe('drawings.createMarkup command', () => {
  const create = vi.fn(async () => ({ version: 1 }));
  const drawings = { projectOfRevision: vi.fn(async () => U(1)) };
  const cmd = createMarkupCommand(drawings as never, { create } as never);
  const shapes = [{ id: 's1', kind: 'pen', points: [{ x: 0.1, y: 0.2 }], strokeWidth: 3 }];
  const m = (payload: Record<string, unknown>, entityId = encodeId('markup', U(6))) => ({
    entityId,
    baseVersion: null,
    clientAt: new Date(),
    payload,
  });

  it('creates the markup under the id the device chose', async () => {
    const r = await cmd.run(scope, m({ revisionId: encodeId('drawingRevision', U(3)), shapes }));
    expect(r).toEqual({ version: 1 });
    expect(create).toHaveBeenCalledWith(scope, U(1), U(3), {
      id: U(6),
      visibility: 'private',
      shapes,
    });
    expect(await cmd.current(scope, encodeId('markup', U(6)))).toBeNull();
  });

  it('rejects bad ids, visibility and shape lists before creating', async () => {
    create.mockClear();
    const rev = encodeId('drawingRevision', U(3));
    await expect(cmd.run(scope, m({ revisionId: rev, shapes }, 'nope'))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(cmd.run(scope, m({ revisionId: 'x', shapes }))).rejects.toBeInstanceOf(AppError);
    await expect(
      cmd.run(scope, m({ revisionId: rev, shapes, visibility: 'everyone' })),
    ).rejects.toBeInstanceOf(AppError);
    await expect(cmd.run(scope, m({ revisionId: rev, shapes: [] }))).rejects.toBeInstanceOf(
      AppError,
    );
    drawings.projectOfRevision.mockResolvedValueOnce(null as never);
    await expect(cmd.run(scope, m({ revisionId: rev, shapes }))).rejects.toMatchObject({
      code: 'drawing_revision.not_found',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
