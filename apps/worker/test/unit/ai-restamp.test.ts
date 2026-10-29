import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@archova/kernel';
import { AI_INDEX_ACTOR } from '@archova/mod-ai';
import type { DocumentRestamper } from '../../src/ai/restamp';
import { createRestamp } from '../../src/ai/restamp';
import type { StoredEvent } from '../../src/subscribers';

const ORG = '0192f0a0-0000-7000-8000-000000000001';
const PROJECT = '0192f0a0-0000-7000-8000-000000000002';
const DOC = '0192f0a0-0000-7000-8000-000000000003';
const SHEET = '0192f0a0-0000-7000-8000-000000000004';

const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: '0192f0a0-0000-7000-8000-0000000000e1',
  orgId: ORG,
  type: 'documents.document.updated.v1',
  projectId: PROJECT,
  entityType: 'document',
  entityId: DOC,
  entityVersion: 2,
  actor: null,
  data: {},
  traceId: null,
  occurredAt: '2026-10-29T10:00:00.000Z',
  ...over,
});

function setup(restampSource?: DocumentRestamper['restampSource']) {
  const restamp = vi.fn<DocumentRestamper['restampSource']>(restampSource ?? (async () => {}));
  const log = vi.fn<(msg: string, o: object) => void>();
  const { subscriber } = createRestamp({ ai: { restampSource: restamp }, log });
  return {
    subscriber,
    restamp,
    log,
    handle: (e: StoredEvent) => subscriber.handle(e, { database: null as never }),
  };
}

describe('the restamp subscriber', () => {
  it("re-stamps a document as the named system actor, in the event's own org, with no plan", async () => {
    const r = setup();
    await r.handle(event());
    expect(r.restamp).toHaveBeenCalledTimes(1);
    const [ctx, projectId, sourceId] = r.restamp.mock.calls[0]!;
    expect(ctx).toMatchObject({
      orgId: ORG,
      userId: AI_INDEX_ACTOR,
      principalType: 'member',
      orgRole: null,
      entitlements: { modules: [] },
    });
    expect(projectId).toBe(PROJECT);
    expect(sourceId).toBe(DOC);
  });

  it('re-stamps the sheet, not the revision, when a drawing is published', async () => {
    const r = setup();
    await r.handle(
      event({
        type: 'documents.drawing.revision.published.v1',
        entityType: 'drawing_revision',
        entityId: '0192f0a0-0000-7000-8000-0000000000aa',
        data: { sheetId: SHEET },
      }),
    );
    expect(r.restamp.mock.calls[0]![2]).toBe(SHEET);
  });

  it('does nothing for an event that names no source, or has no project', async () => {
    const r = setup();
    await r.handle(event({ type: 'documents.document.created.v1' }));
    await r.handle(event({ projectId: null }));
    await r.handle(event({ type: 'documents.drawing.revision.published.v1', data: {} }));
    expect(r.restamp).not.toHaveBeenCalled();
  });

  it('logs ids only', async () => {
    const r = setup();
    await r.handle(event());
    const logged = JSON.stringify(r.log.mock.calls);
    expect(logged).toContain(DOC);
    expect(logged).not.toMatch(/title|text/i);
  });

  it('fails with the error code only, so no stored text reaches the failed-job record', async () => {
    const r = setup(async () => {
      throw new Error('deadlock detected: row (CANARY-5521)');
    });
    const err = await r.handle(event()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err!.message).toBe('ai job failed: Error');
    expect(`${err!.message}\n${err!.stack}`).not.toContain('CANARY');

    const coded = setup(async () => {
      throw new AppError('ai.unavailable');
    });
    await expect(coded.handle(event())).rejects.toThrow('ai job failed: ai.unavailable');
  });
});
