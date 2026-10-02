import { describe, expect, it } from 'vitest';
import { findPublishConflicts, unresolvedConflicts } from '../../src/domain/publish';
import { hiddenFolderIds } from '../../src/domain/folders';
import { canSeeMarkup, invalidShape } from '../../src/domain/markup';

const existing = new Map([
  ['A-101', { currentRev: 'C', revs: ['A', 'B', 'C'] }],
  ['A-102', { currentRev: '1', revs: ['A', '0', '1'] }],
]);

describe('findPublishConflicts (DOC-AC3)', () => {
  it('flags existing revisions, older revisions, new sheets and duplicates', () => {
    const conflicts = findPublishConflicts(
      [
        { id: 'r1', sheetNumber: 'a-101', rev: 'c' },
        { id: 'r2', sheetNumber: 'A-102', rev: 'B' },
        { id: 'r3', sheetNumber: 'A-201', rev: 'A' },
        { id: 'r4', sheetNumber: ' a-201 ', rev: 'B' },
        { id: 'r5', sheetNumber: 'A-101', rev: 'D' },
      ],
      existing,
    );
    expect(conflicts.map((c) => [c.revisionId, c.kind, c.blocking])).toEqual([
      ['r1', 'revision_exists', true],
      ['r2', 'older_than_current', false],
      ['r3', 'new_sheet', false],
      ['r4', 'duplicate_in_set', true],
      ['r5', 'duplicate_in_set', true],
    ]);
  });

  it('clears new sheets by confirmation and older revisions by a reason', () => {
    const conflicts = findPublishConflicts(
      [
        { id: 'r2', sheetNumber: 'A-102', rev: 'B' },
        { id: 'r3', sheetNumber: 'A-201', rev: 'A' },
      ],
      existing,
    );
    expect(
      unresolvedConflicts(conflicts, { confirmNewSheets: false, reasons: new Map() }),
    ).toHaveLength(2);
    expect(
      unresolvedConflicts(conflicts, {
        confirmNewSheets: true,
        reasons: new Map([['r2', 'Reverting to the approved scheme']]),
      }),
    ).toEqual([]);
  });

  it('passes a normal next revision with no conflicts', () => {
    expect(findPublishConflicts([{ id: 'r', sheetNumber: 'A-102', rev: '2' }], existing)).toEqual(
      [],
    );
  });
});

describe('hiddenFolderIds', () => {
  const folders = [
    { id: 'root', parentId: null, isPrivate: false, allowedUserIds: [], allowedCompanyIds: [] },
    {
      id: 'legal',
      parentId: 'root',
      isPrivate: true,
      allowedUserIds: ['u2'],
      allowedCompanyIds: [],
    },
    {
      id: 'legal/sub',
      parentId: 'legal',
      isPrivate: false,
      allowedUserIds: [],
      allowedCompanyIds: [],
    },
    {
      id: 'trade',
      parentId: 'root',
      isPrivate: true,
      allowedUserIds: [],
      allowedCompanyIds: ['c1'],
    },
  ];

  it('hides private folders and their children from everyone not allowed', () => {
    const hidden = hiddenFolderIds(folders, { userId: 'u1', companyId: 'c9', seesPrivate: false });
    expect([...hidden].sort()).toEqual(['legal', 'legal/sub', 'trade']);
  });

  it('lets allowed users, allowed companies and document admins in', () => {
    expect(
      hiddenFolderIds(folders, { userId: 'u2', companyId: 'c1', seesPrivate: false }).size,
    ).toBe(0);
    expect(
      hiddenFolderIds(folders, { userId: 'u1', companyId: null, seesPrivate: true }).size,
    ).toBe(0);
  });
});

describe('markups', () => {
  it('validates shapes', () => {
    expect(
      invalidShape([{ id: 'a', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }]),
    ).toBe(null);
    expect(
      invalidShape([{ id: 'a', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 2, y: 1 } }]),
    ).toMatchObject({ index: 0 });
    expect(
      invalidShape([
        { id: 'a', kind: 'text', at: { x: 0.5, y: 0.5 }, text: 'Check' },
        { id: 'a', kind: 'text', at: { x: 0.5, y: 0.5 }, text: 'Dupe' },
      ]),
    ).toMatchObject({ index: 1 });
    expect(invalidShape([{ id: 'a', kind: 'laser' }])).toMatchObject({ index: 0 });
  });

  it('applies private, company and project visibility (X12)', () => {
    const m = { ownerId: 'u1', ownerCompanyId: 'c1' };
    const other = { userId: 'u2', companyId: 'c1' };
    const outsider = { userId: 'u3', companyId: 'c2' };
    expect(canSeeMarkup({ ...m, visibility: 'private' }, other)).toBe(false);
    expect(canSeeMarkup({ ...m, visibility: 'company' }, other)).toBe(true);
    expect(canSeeMarkup({ ...m, visibility: 'company' }, outsider)).toBe(false);
    expect(canSeeMarkup({ ...m, visibility: 'project' }, outsider)).toBe(true);
    expect(canSeeMarkup({ ...m, visibility: 'private' }, { userId: 'u1', companyId: null })).toBe(
      true,
    );
  });
});
