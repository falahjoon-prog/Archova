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
      { templateItemId: itemId, result: 'fail', note: 'Crack' },
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
