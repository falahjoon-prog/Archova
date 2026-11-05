import { describe, expect, it, vi } from 'vitest';
import { encodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { InspectionService } from '../../src/application/inspections';
import { syncPieces } from '../../src/module';

const insId = '0191a5b0-0000-7000-8000-000000000001';
const projId = '0191a5b0-0000-7000-8000-000000000002';
const itemId = '0191a5b0-0000-7000-8000-000000000003';
const scope = {} as TenantScope;

function fake() {
  const detail = { inspection: { id: insId, version: 4 }, items: [], responses: [] };
  const service = {
    projectOf: vi.fn(async () => projId),
    detail: vi.fn(async () => detail),
    recordResponses: vi.fn(async () => ({ inspection: { version: 5 } })),
    submit: vi.fn(async () => ({ inspection: { version: 6 } })),
    visibleAmong: vi.fn(async () => []),
    create: vi.fn(async () => ({ inspection: { version: 1 } })),
    templateProjectOf: vi.fn(async (): Promise<string | null> => projId),
    templatesAmong: vi.fn(async (): Promise<unknown[]> => []),
  };
  return { service, pieces: syncPieces(service as unknown as InspectionService) };
}
const command = (pieces: ReturnType<typeof syncPieces>, name: string) =>
  pieces.syncCommands.find((c) => c.name === name)!;
const mutation = (over: object) => ({
  entityId: encodeId('inspection', insId),
  baseVersion: null,
  clientAt: new Date(),
  payload: {},
  ...over,
});

describe('quality sync commands', () => {
  it('saves answers through the same service call as the REST endpoint', async () => {
    const { service, pieces } = fake();
    const result = await command(pieces, 'quality.recordResponses').run(
      scope,
      mutation({
        payload: {
          responses: [
            { templateItemId: encodeId('inspectionItem', itemId), result: 'fail', note: 'Crack' },
          ],
        },
      }),
    );
    expect(result).toEqual({ version: 5 });
    expect(service.recordResponses).toHaveBeenCalledWith(scope, projId, insId, [
      { templateItemId: itemId, result: 'fail', note: 'Crack', fileIds: [] },
    ]);
  });

  it("keeps an item's photos when the answer does not mention them", async () => {
    const { service, pieces } = fake();
    service.detail.mockResolvedValue({
      inspection: { id: insId, version: 4 },
      items: [],
      responses: [{ templateItemId: itemId, fileIds: ['f1'] }],
    } as never);
    await command(pieces, 'quality.recordResponses').run(
      scope,
      mutation({
        payload: {
          responses: [{ templateItemId: encodeId('inspectionItem', itemId), result: 'pass' }],
        },
      }),
    );
    expect(service.recordResponses).toHaveBeenCalledWith(scope, projId, insId, [
      { templateItemId: itemId, result: 'pass', fileIds: ['f1'] },
    ]);
  });

  it('rejects malformed answers before touching the service', async () => {
    const { service, pieces } = fake();
    const run = command(pieces, 'quality.recordResponses').run;
    await expect(run(scope, mutation({ payload: { responses: [] } }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(
      run(scope, mutation({ payload: { responses: [{ templateItemId: 'nope' }] } })),
    ).rejects.toBeInstanceOf(AppError);
    expect(service.recordResponses).not.toHaveBeenCalled();
  });

  it('submits against the base version and needs a signer', async () => {
    const { service, pieces } = fake();
    const run = command(pieces, 'quality.submit').run;
    await expect(run(scope, mutation({ payload: { signedByName: 'A' } }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(run(scope, mutation({ baseVersion: 4, payload: {} }))).rejects.toBeInstanceOf(
      AppError,
    );
    expect(
      await run(scope, mutation({ baseVersion: 4, payload: { signedByName: ' Sam ' } })),
    ).toEqual({
      version: 6,
    });
    expect(service.submit).toHaveBeenCalledWith(scope, projId, insId, 4, { signedByName: ' Sam ' });
  });

  it('reports the inspection as not found when it is gone', async () => {
    const { service, pieces } = fake();
    service.projectOf.mockResolvedValue(null as never);
    await expect(
      command(pieces, 'quality.submit').run(
        scope,
        mutation({ baseVersion: 1, payload: { signedByName: 'A' } }),
      ),
    ).rejects.toMatchObject({ code: 'inspection.not_found' });
    expect(
      await command(pieces, 'quality.submit').current(scope, encodeId('inspection', insId)),
    ).toBeNull();
  });
});

describe('quality sync source', () => {
  it('serves inspections and nothing for observations', async () => {
    const { service, pieces } = fake();
    service.visibleAmong.mockResolvedValue([
      {
        inspection: { id: insId, version: 4 },
        items: [],
        responses: [],
        missingRequiredItemIds: [],
        failedItemIds: [],
      },
    ] as never);
    // toInspectionDetail needs a full row, so only check what the source asks of the service.
    await pieces.syncSource.load(scope, {
      projectId: projId,
      entityType: 'observation',
      ids: [insId],
    });
    expect(service.visibleAmong).not.toHaveBeenCalled();
    expect(pieces.syncSource.publicId('observation', insId)).toMatch(/^obs_/);
    expect(pieces.syncSource.publicId('inspection', insId)).toMatch(/^ins_/);
  });
});

const tplId = '0191a5b0-0000-7000-8000-000000000004';

describe('quality.startInspection', () => {
  const start = (over: object = {}) =>
    mutation({
      payload: { templateId: encodeId('inspectionTemplate', tplId), ...over },
    });

  it('creates the inspection under the id the device chose, in the template project', async () => {
    const { service, pieces } = fake();
    const cmd = command(pieces, 'quality.startInspection');
    expect(await cmd.run(scope, start({ title: ' Slab pour ', location: 'Level 2' }))).toEqual({
      version: 1,
    });
    expect(service.create).toHaveBeenCalledWith(scope, projId, {
      id: insId,
      templateId: tplId,
      title: ' Slab pour ',
      location: 'Level 2',
    });
    expect(await cmd.current(scope, encodeId('inspection', insId))).toBeNull();
  });

  it('leaves out blank text and rejects bad ids, long text and unknown templates', async () => {
    const { service, pieces } = fake();
    const run = command(pieces, 'quality.startInspection').run;
    await run(scope, start({ title: '  ', location: null }));
    expect(service.create).toHaveBeenLastCalledWith(scope, projId, {
      id: insId,
      templateId: tplId,
    });
    service.create.mockClear();
    await expect(run(scope, mutation({ payload: { templateId: 'x' } }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(run(scope, start({ title: 'x'.repeat(201) }))).rejects.toBeInstanceOf(AppError);
    await expect(run(scope, { ...start(), entityId: 'nope' })).rejects.toBeInstanceOf(AppError);
    service.templateProjectOf.mockResolvedValueOnce(null);
    await expect(run(scope, start())).rejects.toMatchObject({
      code: 'inspection_template.not_found',
    });
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('quality sync source: templates', () => {
  it('serves published checklists flat, with their items, and names their public id', async () => {
    const { service, pieces } = fake();
    const now = new Date('2026-11-05T01:00:00Z');
    service.templatesAmong.mockResolvedValueOnce([
      {
        template: {
          id: tplId,
          projectId: projId,
          name: 'Pre-pour',
          type: 'inspection',
          version: 2,
          published: true,
          createdAt: now,
          updatedAt: now,
        },
        items: [
          {
            id: itemId,
            section: 'Formwork',
            sort: 0,
            prompt: 'Level?',
            responseType: 'pass_fail_na',
            options: [],
            required: true,
            createsDefectOnFail: false,
          },
        ],
      },
    ]);
    const out = await pieces.syncSource.load(scope, {
      projectId: projId,
      entityType: 'inspection_template',
      ids: [tplId],
    });
    expect(out.get(tplId)).toMatchObject({
      version: 2,
      data: {
        name: 'Pre-pour',
        projectId: expect.stringMatching(/^prj_/),
        items: [{ prompt: 'Level?', section: 'Formwork' }],
      },
    });
    expect(pieces.syncSource.publicId('inspection_template', tplId)).toBe(
      encodeId('inspectionTemplate', tplId),
    );
  });
});

describe('quality.attachItemPhoto', () => {
  const fileId = '0191a5b0-0000-7000-8000-000000000005';
  const photo = (over: object = {}) =>
    mutation({
      payload: {
        templateItemId: encodeId('inspectionItem', itemId),
        fileId: encodeId('file', fileId),
        ...over,
      },
    });
  const withResponse = (service: ReturnType<typeof fake>['service'], r: object | null) =>
    service.detail.mockResolvedValue({
      inspection: { id: insId, version: 4 },
      items: [],
      responses: r ? [{ templateItemId: itemId, ...r }] : [],
    } as never);

  it('adds the file to the item and keeps the rest of the answer', async () => {
    const { service, pieces } = fake();
    withResponse(service, { value: null, result: 'fail', note: 'Crack', fileIds: ['other'] });
    const result = await command(pieces, 'quality.attachItemPhoto').run(scope, photo());
    expect(result).toEqual({ version: 5 });
    expect(service.recordResponses).toHaveBeenCalledWith(scope, projId, insId, [
      { templateItemId: itemId, result: 'fail', note: 'Crack', fileIds: ['other', fileId] },
    ]);
  });

  it('starts a photo item with just the file', async () => {
    const { service, pieces } = fake();
    withResponse(service, null);
    await command(pieces, 'quality.attachItemPhoto').run(scope, photo());
    expect(service.recordResponses).toHaveBeenCalledWith(scope, projId, insId, [
      { templateItemId: itemId, fileIds: [fileId] },
    ]);
  });

  it('does nothing when a retry finds the file already attached', async () => {
    const { service, pieces } = fake();
    withResponse(service, { value: null, result: null, note: null, fileIds: [fileId] });
    expect(await command(pieces, 'quality.attachItemPhoto').run(scope, photo())).toEqual({
      version: 4,
    });
    expect(service.recordResponses).not.toHaveBeenCalled();
  });

  it('rejects bad ids and a full item before touching the answer', async () => {
    const { service, pieces } = fake();
    const run = command(pieces, 'quality.attachItemPhoto').run;
    withResponse(service, null);
    await expect(run(scope, photo({ fileId: 'x' }))).rejects.toBeInstanceOf(AppError);
    await expect(run(scope, photo({ templateItemId: 'x' }))).rejects.toBeInstanceOf(AppError);
    withResponse(service, {
      value: null,
      result: null,
      note: null,
      fileIds: Array.from({ length: 20 }, (_, i) => `f${i}`),
    });
    await expect(run(scope, photo())).rejects.toBeInstanceOf(AppError);
    expect(service.recordResponses).not.toHaveBeenCalled();
  });
});
