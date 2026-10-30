import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishBlockers } from '../data/source';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('@/shared/lib/uploads', () => ({
  uploadFile: vi.fn(async (_org: string, input: { file: File }) => ({
    id: `fil_${input.file.name.replace(/\W/g, '')}`,
    filename: input.file.name,
  })),
  fileDownloadUrl: vi.fn(),
}));

const { createDrawingsApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const me = { id: 'usr_me', name: 'Test User', companyId: 'cmp_builder' };

const revision = (over: Record<string, unknown>) => ({
  id: 'drv_c',
  projectId: 'prj_1',
  setId: 'dst_1',
  sheetId: 'dsh_a101',
  sheetNumber: 'A-101',
  title: 'Ground floor plan',
  discipline: 'A',
  rev: 'C',
  issuedFor: 'for_construction',
  fileId: 'fil_set3',
  pageIndex: 0,
  status: 'current',
  drawingDate: '2026-09-10',
  publishReason: null,
  publishedAt: '2026-09-12T01:00:00Z',
  supersededBy: null,
  version: 1,
  ...over,
});

const titleBlock = (page: number, over: Record<string, unknown> = {}) => {
  const f = (value: string | null, confidence = 0.95, flagged = false) => ({
    value,
    confidence,
    flagged,
    reason: null,
  });
  return {
    fileId: 'fil_IFC4pdf',
    page,
    sheetLabel: '',
    isDrawing: true,
    fields: {
      number: f('A-101'),
      title: f('Ground floor plan'),
      revision: f('D'),
      discipline: f('architectural'),
      revisionDate: f('2026-09-30'),
      scale: f('1:100'),
      ...over,
    },
    flagged: [],
    match: null,
  };
};

beforeEach(() => fake.reset());

describe('drawings API source', () => {
  it('builds the sheet from its revisions, newest first, with the superseded banner fields (DOC-AC6)', async () => {
    fake.on('GET', `${P}/drawings/{drawingSheetId}/revisions`, () => ({
      data: [
        revision({}),
        revision({
          id: 'drv_b',
          rev: 'B',
          status: 'superseded',
          supersededBy: { revisionId: 'drv_c', rev: 'C', at: '2026-09-12T01:00:00Z' },
        }),
      ],
    }));
    const { sheet, revisions } = await createDrawingsApi('org_1').getSheet('prj_1', 'dsh_a101');
    expect(sheet).toMatchObject({ sheetNumber: 'A-101', currentRev: 'C', revisionCount: 2 });
    expect(revisions.map((r) => [r.rev, r.status, r.supersededByRev])).toEqual([
      ['C', 'current', null],
      ['B', 'superseded', 'C'],
    ]);
    // The PDF page to render; its size comes from the PDF.
    expect(revisions[0]).toMatchObject({ fileId: 'fil_set3', pageIndex: 0, widthMm: null });
  });

  it('splits markups into shapes and pins, and creates one markup per shape', async () => {
    fake.on('GET', `${P}/drawing-revisions/{drawingRevisionId}/markups`, () => ({
      data: [
        {
          id: 'mku_1',
          projectId: 'prj_1',
          revisionId: 'drv_c',
          ownerId: 'usr_me',
          ownerCompanyId: 'cmp_builder',
          visibility: 'private',
          shapes: [
            { id: 's1', kind: 'cloud', from: { x: 0.1, y: 0.1 }, to: { x: 0.2, y: 0.2 } },
            {
              id: 's2',
              kind: 'pin',
              at: { x: 0.5, y: 0.5 },
              entityType: 'rfi',
              entityId: 'rfi_3',
              text: 'RFI-003',
            },
            {
              id: 's3',
              kind: 'pin',
              at: { x: 0.6, y: 0.5 },
              entityType: 'photo',
              entityId: 'pho_1',
            },
          ],
          copiedFromId: null,
          needsLocationCheck: true,
          publishedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
          version: 3,
        },
      ],
    }));
    // RFIs pinned on the revision itself: RFI-003 is already a markup pin, RFI-004 isn't.
    fake.on('GET', `${P}/rfis`, () => ({
      data: [
        {
          id: 'rfi_3',
          numberLabel: 'RFI-003',
          subject: 'Slab edge',
          status: 'open',
          pin: { drawingRevisionId: 'drv_c', x: 0.5, y: 0.5 },
        },
        {
          id: 'rfi_4',
          numberLabel: 'RFI-004',
          subject: 'Lighting circuit',
          status: 'open',
          pin: { drawingRevisionId: 'drv_c', x: 0.4, y: 0.47 },
        },
      ],
      nextCursor: null,
    }));
    // Defects pinned on the revision: the open one gets a spot, the closed one doesn't.
    fake.on('GET', `${P}/defects`, () => ({
      data: [
        {
          id: 'dfx_1',
          numberLabel: 'DEF-0001',
          title: 'Cracked tile',
          status: 'open',
          pin: { drawingRevisionId: 'drv_c', x: 0.2, y: 0.8 },
        },
        {
          id: 'dfx_2',
          numberLabel: 'DEF-0002',
          title: 'Fixed already',
          status: 'closed',
          pin: { drawingRevisionId: 'drv_c', x: 0.3, y: 0.3 },
        },
      ],
      nextCursor: null,
    }));
    const source = createDrawingsApi('org_1');
    const markups = await source.listMarkups('prj_1', 'drv_c', me);
    expect(markups).toHaveLength(1);
    expect(markups[0]).toMatchObject({ id: 'mku_1~s1', ownerName: 'Test User', version: 3 });
    const pins = await source.listPins('prj_1', 'drv_c');
    expect(pins).toEqual([
      expect.objectContaining({ entityId: 'rfi_3', label: 'RFI-003', checkLocation: true }),
      expect.objectContaining({
        entityType: 'rfi',
        entityId: 'rfi_4',
        label: 'RFI-004',
        title: 'Lighting circuit',
        x: 0.4,
        y: 0.47,
        checkLocation: false,
      }),
      expect.objectContaining({
        entityType: 'defect',
        entityId: 'dfx_1',
        label: 'DEF-0001',
        title: 'Cracked tile',
        x: 0.2,
        y: 0.8,
      }),
    ]);
    expect(fake.callsTo('GET', `${P}/defects`)[0]!.init.params?.query).toMatchObject({
      drawingRevisionId: 'drv_c',
    });
    expect(fake.callsTo('GET', `${P}/rfis`)[0]!.init.params?.query).toMatchObject({
      drawingRevisionId: 'drv_c',
    });

    fake.on('PATCH', `${P}/drawing-revisions/{drawingRevisionId}/markups/{markupId}`, () => ({}));
    await source.confirmPinLocation('prj_1', 'drv_c', pins[0]!.id);
    const patch = fake.callsTo(
      'PATCH',
      `${P}/drawing-revisions/{drawingRevisionId}/markups/{markupId}`,
    )[0]!;
    expect(patch.init.params?.header).toEqual({ 'If-Match': '"3"' });
    expect(patch.init.body).toEqual({ locationConfirmed: true });
  });

  it('turns an upload into a set to review, blocks publish on flagged fields, then records the decision', async () => {
    const created: Array<Record<string, unknown>> = [];
    fake.on('POST', `${P}/drawing-sets`, () => ({ id: 'dst_9', name: 'IFC 4' }));
    fake.on('POST', `${P}/ai/drawing-register/extractions`, () => ({
      suggestions: [
        { id: 'ais_1', status: 'pending', payload: titleBlock(1) },
        {
          id: 'ais_2',
          status: 'pending',
          payload: titleBlock(2, {
            number: { value: 'A-11O', confidence: 0.4, flagged: true, reason: 'low_confidence' },
            revision: { value: null, confidence: 0, flagged: true, reason: 'missing' },
          }),
        },
      ],
      pageCount: 3,
      skippedPages: [],
      refusedPages: [],
    }));
    fake.on('POST', `${P}/drawing-sets/{drawingSetId}/revisions`, (init) => {
      created.push(init.body as Record<string, unknown>);
      return {};
    });
    const draft = () =>
      created.map((b, i) =>
        revision({
          id: `drv_d${i}`,
          sheetId: null,
          status: 'draft',
          setId: 'dst_9',
          fileId: b.fileId,
          pageIndex: b.pageIndex,
          sheetNumber: b.sheetNumber,
          title: b.title,
          rev: b.rev,
          discipline: b.discipline ?? null,
          version: 1,
        }),
      );
    fake.on('GET', `${P}/drawing-sets/{drawingSetId}/review`, () => ({
      set: { id: 'dst_9', name: 'IFC 4', status: 'review', createdAt: '2026-10-02T00:00:00Z' },
      revisions: draft(),
      conflicts: [
        {
          revisionId: 'drv_d1',
          sheetNumber: 'A-11O',
          kind: 'new_sheet',
          blocking: true,
          currentRev: null,
        },
      ],
    }));
    fake.on('GET', `${P}/ai/suggestions`, () => ({
      data: [
        { id: 'ais_1', status: 'pending', payload: titleBlock(1) },
        {
          id: 'ais_2',
          status: 'pending',
          payload: titleBlock(2, {
            number: { value: 'A-11O', confidence: 0.4, flagged: true, reason: 'low_confidence' },
            revision: { value: null, confidence: 0, flagged: true, reason: 'missing' },
          }),
        },
      ],
      nextCursor: null,
    }));
    fake.on('GET', '/v1/orgs/{orgId}/files/{fileId}', () => ({ filename: 'IFC4.pdf' }));

    const source = createDrawingsApi('org_1');
    const set = await source.createSet('prj_1', {
      name: 'IFC 4',
      issuedFor: 'for_construction',
      files: [new File(['%PDF'], 'IFC4.pdf')],
    });
    expect(created).toEqual([
      expect.objectContaining({
        sheetNumber: 'A-101',
        rev: 'D',
        discipline: 'A',
        pageIndex: 0,
        aiSuggestionId: 'ais_1',
      }),
      expect.objectContaining({
        sheetNumber: 'A-11O',
        rev: '?',
        pageIndex: 1,
        aiSuggestionId: 'ais_2',
      }),
    ]);
    expect(set.sheets.map((s) => s.fileName)).toEqual(['IFC4.pdf', 'IFC4.pdf']);
    expect(set.sheets[1]?.conflict).toBe('new_sheet');
    expect(publishBlockers(set)).toHaveLength(1);
    await expect(source.publishSet('prj_1', 'dst_9')).rejects.toMatchObject({ status: 422 });

    // The person fixes the number and the revision; the draft revision is patched with its version.
    fake.on('PATCH', `${P}/drawing-sets/{drawingSetId}/revisions/{drawingRevisionId}`, (init) => {
      Object.assign(created[1]!, init.body);
      return {};
    });
    const fixed = await source.updateReviewSheet('prj_1', 'dst_9', 'drv_d1', {
      sheetNumber: 'A-110',
      rev: 'A',
    });
    const patch = fake.callsTo(
      'PATCH',
      `${P}/drawing-sets/{drawingSetId}/revisions/{drawingRevisionId}`,
    )[0]!;
    expect(patch.init.body).toEqual({ sheetNumber: 'A-110', rev: 'A' });
    expect(patch.init.params?.header).toEqual({ 'If-Match': '"1"' });
    expect(publishBlockers(fixed)).toEqual([]);

    const decisions: unknown[] = [];
    fake.on('POST', `${P}/ai/suggestions/{suggestionId}/decision`, (init) => {
      decisions.push([init.params?.path?.suggestionId, init.body]);
      return {};
    });
    fake.on('POST', `${P}/drawing-sets/{drawingSetId}/publish`, () => ({}));
    await expect(source.publishSet('prj_1', 'dst_9')).resolves.toEqual({ published: 2 });
    expect(decisions).toEqual([
      ['ais_1', { decision: 'accepted' }],
      [
        'ais_2',
        {
          decision: 'edited',
          fields: {
            number: 'A-110',
            title: 'Ground floor plan',
            revision: 'A',
            discipline: 'architectural',
          },
        },
      ],
    ]);
    expect(fake.callsTo('POST', `${P}/drawing-sets/{drawingSetId}/publish`)[0]!.init.body).toEqual({
      confirmNewSheets: true,
      reasons: [],
    });
  });

  it('has no geometry yet, so measuring stays off', async () => {
    await expect(createDrawingsApi('org_1').getGeometry('prj_1', 'drv_c')).resolves.toBeNull();
  });

  it("moves an RFI's or a defect's own pin with the version it last read", async () => {
    const R = `${P}/rfis/{rfiId}`;
    const D = `${P}/defects/{defectId}`;
    fake.on('GET', R, () => ({ rfi: { id: 'rfi_4', version: 5 }, responses: [] }));
    fake.on('PATCH', R, () => ({ rfi: { id: 'rfi_4', version: 6 }, responses: [] }));
    fake.on('GET', D, () => ({ defect: { id: 'dfx_1', version: 2 } }));
    fake.on('PATCH', D, () => ({ defect: { id: 'dfx_1', version: 3 } }));
    const source = createDrawingsApi('org_1');
    const pin = (entityType: 'rfi' | 'defect', entityId: string) => ({
      id: `${entityType}~${entityId}`,
      entityType,
      entityId,
      label: 'X',
      title: 'T',
      status: 'open',
      x: 0.1,
      y: 0.1,
      checkLocation: false,
      movable: true,
    });
    await source.movePin('prj_1', 'drv_c', pin('rfi', 'rfi_4'), { x: 0.6, y: 0.7 });
    const rfiPatch = fake.callsTo('PATCH', R)[0]!;
    expect(rfiPatch.init.params?.header).toEqual({ 'If-Match': '"5"' });
    expect(rfiPatch.init.body).toEqual({ pin: { drawingRevisionId: 'drv_c', x: 0.6, y: 0.7 } });
    await source.movePin('prj_1', 'drv_c', pin('defect', 'dfx_1'), { x: 0.2, y: 0.3 });
    const defectPatch = fake.callsTo('PATCH', D)[0]!;
    expect(defectPatch.init.params?.header).toEqual({ 'If-Match': '"2"' });
    expect(defectPatch.init.body).toEqual({ pin: { drawingRevisionId: 'drv_c', x: 0.2, y: 0.3 } });
  });
});
