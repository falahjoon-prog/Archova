import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { RECORD_EVENT_TYPES } from '@archova/mod-ai';
import { AI_REINDEX_ROUTE } from '../../src/ai/declaration';
import { dispatch } from '../../src/queues';
import type { Subscriber } from '../../src/subscribers';

const audit: Subscriber = { name: 'audit', types: ['*'], handle: async () => {} };

describe('the ai re-index route', () => {
  it('asks for the events the ai module says change a record', () => {
    expect([...AI_REINDEX_ROUTE.types]).toEqual([...RECORD_EVENT_TYPES]);
  });

  it('sends record events to the ai queue only, and leaves every other event to the default queue', async () => {
    const def = { addBulk: vi.fn(async (_jobs: unknown[]) => []) };
    const ai = { addBulk: vi.fn(async (_jobs: unknown[]) => []) };
    const registry = [audit, AI_REINDEX_ROUTE];

    const defect = { id: 'e1', orgId: 'o1', type: 'defects.defect.voided.v1' };
    expect(await dispatch(defect, registry, def, { ai })).toBe(2);
    expect(def.addBulk).toHaveBeenCalledTimes(1);
    expect(ai.addBulk).toHaveBeenCalledTimes(1);
    expect(ai.addBulk.mock.calls[0]![0]).toMatchObject([
      { name: 'ai.reindex-records', opts: { jobId: 'e1.ai.reindex-records' } },
    ]);
    expect(def.addBulk.mock.calls[0]![0]).toMatchObject([{ name: 'audit' }]);

    def.addBulk.mockClear();
    ai.addBulk.mockClear();
    expect(
      await dispatch({ id: 'e2', orgId: 'o1', type: 'files.object.created.v1' }, registry, def, {
        ai,
      }),
    ).toBe(1);
    expect(ai.addBulk).not.toHaveBeenCalled();
    expect(def.addBulk).toHaveBeenCalledTimes(1);
  });

  it('fails loudly if a route has no queue, rather than dropping the event', async () => {
    const def = { addBulk: vi.fn(async (_jobs: unknown[]) => []) };
    await expect(
      dispatch({ id: 'e1', orgId: 'o1', type: 'rfis.rfi.sent.v1' }, [AI_REINDEX_ROUTE], def),
    ).rejects.toThrow(/No queue for subscriber ai.reindex-records/);
  });
});

describe('the default worker bundle', () => {
  it('does not import what only the ai-worker image carries', async () => {
    // pdfjs-dist, argon2 and the native canvas are absent from the worker image: a static import would crash it at start.
    const result = await build({
      entryPoints: ['src/main.ts'],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      external: ['pg-native', '@napi-rs/canvas', 'pdfjs-dist', '@node-rs/argon2'],
    });
    const imported = Object.values(result.metafile.outputs)
      .flatMap((o) => o.imports)
      .filter((i) => i.external)
      .map((i) => i.path);
    expect(imported.filter((p) => /pdfjs-dist|argon2|canvas/.test(p))).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((p) => p.includes('modules/ai/') || p.includes('packages/compose/'))).toBe(
      false,
    );
  });
});
