import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import { TOOLS } from '../lib/tools';
import { migrate } from '../lib/db';
import { ActionQueue, type QueuedAction } from '../lib/actions/action-queue';
import { PretaskCache } from '../lib/actions/pretask-cache';
import { createActionSender } from '../lib/actions/send';
import {
  closeBlockers,
  draftFromLast,
  emptyDraft,
  hazardWarnings,
  lastFromDraft,
  lastPlanLabel,
  mergeSuggestions,
  missingHazards,
  saveProblems,
  toPayload,
} from '../features/pretask';
import { nodeSqlDriver } from './support/node-sql';

vi.mock('../features/pretask/screens/PretaskScreen', () => ({}));
vi.mock('../features/pretask/screens/PretaskNewScreen', () => ({}));

const hazard = {
  hazard: 'Fall from height',
  riskBefore: 'high' as const,
  controls: 'Harness',
  riskAfter: 'low' as const,
};
const strokes = [
  [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.8 },
  ],
];

describe('pre-task plan form', () => {
  it('is a tool inside the project', () => {
    const tool = TOOLS.find((x) => x.id === 'pretask');
    expect(tool?.route('prj_1')).toBe(mobileRoutes.pretaskPlans('prj_1'));
    expect(mobileRoutes.pretaskNew('prj_1')).toBe('/project/prj_1/pre-task/new');
  });

  it("starts from yesterday's plan without carrying signatures across", () => {
    const last = {
      workDate: '2026-11-20',
      taskTitle: 'Strip formwork',
      supervisorName: 'Sam',
      location: 'Level 2',
      hazards: [hazard],
      crew: [{ personName: 'Dee' }],
    };
    const d = draftFromLast(last, '2026-11-21', 'Me');
    expect(d).toMatchObject({
      taskTitle: 'Strip formwork',
      workDate: '2026-11-21',
      location: 'Level 2',
    });
    expect(d.crew).toEqual([{ personName: 'Dee' }]);
    expect(lastPlanLabel(last, '2026-11-21')).toBe("yesterday's plan");
    expect(lastPlanLabel(last, '2026-11-25')).toBe('the plan from 20 Nov');
  });

  it('checks what stops saving and what stops closing', () => {
    const d = emptyDraft('2026-11-21', 'Sam');
    expect(saveProblems(d)).toEqual(['Say what the task is.']);
    d.taskTitle = 'Pour slab';
    expect(saveProblems(d)).toEqual([]);
    expect(closeBlockers(d)).toEqual([
      'Add at least one hazard.',
      'Add the people doing the task.',
    ]);
    d.hazards = [{ ...hazard, controls: ' ', riskAfter: 'extreme' }];
    d.crew = [{ personName: 'Dee' }];
    expect(closeBlockers(d)).toEqual([
      'Every hazard needs a control.',
      'A hazard is still extreme risk after its controls. Do not start the work.',
      'Everyone on the crew has to sign.',
    ]);
    d.hazards = [hazard];
    d.crew = [{ personName: 'Dee', strokes }];
    expect(closeBlockers(d)).toEqual([]);
    expect(toPayload(d, true)).toMatchObject({ close: true, hazards: [hazard] });
  });

  it('warns about a hazard rated riskier after its controls', () => {
    const d = emptyDraft('2026-11-21', 'Sam');
    d.hazards = [{ ...hazard, riskBefore: 'low', riskAfter: 'high' }];
    expect(hazardWarnings(d)[0]).toContain('riskier after');
  });
});

describe('Nova flags missing hazards with no signal', () => {
  it('raises hazards the task brings and the plan does not cover', () => {
    const flags = missingHazards('Erect scaffold and cut pavers', []);
    expect(flags.map((f) => f.hazard)).toEqual(
      expect.arrayContaining(['Fall from height', 'Silica dust']),
    );
  });
  it('stays quiet about one already on the plan, and for an empty task', () => {
    expect(
      missingHazards('Erect scaffold', [{ hazard: 'Falls from the scaffold edge' }]).map(
        (f) => f.hazard,
      ),
    ).not.toContain('Fall from height');
    expect(missingHazards('  ', [])).toEqual([]);
  });
  it("puts the project's own suggestions first and never repeats one", () => {
    const own = {
      hazard: 'Fall from height',
      controls: 'x',
      riskBefore: 'high' as const,
      because: 'recurring',
    };
    const merged = mergeSuggestions([own], missingHazards('Roof work', []), []);
    expect(merged[0]).toBe(own);
    expect(merged.filter((m) => m.hazard === 'Fall from height')).toHaveLength(1);
  });
});

describe('last plan on the phone', () => {
  it('keeps the newest plan and survives a restart', async () => {
    const db = await nodeSqlDriver().open('pt');
    await migrate(db);
    const cache = new PretaskCache(db);
    const d = emptyDraft('2026-11-21', 'Sam');
    d.taskTitle = 'Pour slab';
    await cache.put('prj_1', lastFromDraft(d));
    await cache.put('prj_1', lastFromDraft({ ...d, workDate: '2026-11-19', taskTitle: 'Older' }));
    expect((await cache.get('prj_1'))?.taskTitle).toBe('Pour slab');
    expect(await cache.get('prj_2')).toBeNull();
  });
});

type Json = Record<string, unknown>;
function server(opts: { alreadySigned?: boolean; closeRefused?: boolean } = {}) {
  const calls: { method: string; path: string; body?: Json; header?: Record<string, string> }[] =
    [];
  let version = 1;
  const crew = [
    {
      id: 'ptc_1',
      personName: 'Dee',
      signedAt: opts.alreadySigned ? '2026-11-21T00:00:00Z' : null,
    },
    { id: 'ptc_2', personName: 'Lee', signedAt: null },
  ];
  const detail = () => ({ plan: { id: 'ptk_1', version, status: 'open' }, crew });
  const reply =
    (method: string) =>
    async (path: string, o: { body?: Json; params: { header?: Record<string, string> } }) => {
      calls.push({
        method,
        path,
        ...(o.body ? { body: o.body } : {}),
        ...(o.params.header ? { header: o.params.header } : {}),
      });
      if (method === 'PUT') {
        version++;
        const id = (o as unknown as { params: { path: { crewId: string } } }).params.path.crewId;
        crew.find((c) => c.id === id)!.signedAt = 'now';
      }
      if (opts.closeRefused && path.endsWith('/transition')) {
        const { ApiError } = await import('@archova/api-client');
        throw new ApiError(422, { detail: 'Cannot close' } as never);
      }
      return { data: detail(), response: { ok: true, status: 200 } };
    };
  return {
    api: { GET: reply('GET'), POST: reply('POST'), PUT: reply('PUT') } as unknown as ApiClient,
    calls,
  };
}

const action = (payload: Json): QueuedAction => ({
  id: 'act_1',
  projectId: 'prj_1',
  kind: 'pretask.submit',
  targetId: 'act_1',
  payload,
  state: 'pending',
  lastError: null,
  attempts: 0,
  createdAt: '2026-11-21T00:00:00.000Z',
});
const payload = (close: boolean) =>
  toPayload(
    {
      ...emptyDraft('2026-11-21', 'Sam'),
      taskTitle: 'Pour slab',
      hazards: [hazard],
      crew: [
        { personName: 'Dee', strokes },
        { personName: 'Lee', strokes },
      ],
    },
    close,
  ) as unknown as Json;

describe('a queued plan is replayed in order', () => {
  it('creates once with the action id as idempotency key, signs each person, then closes', async () => {
    const { api, calls } = server();
    const upload = vi.fn(async (key: string) => `fil_${key}`);
    await createActionSender(api, 'org_1', { uploadSignature: upload })(action(payload(true)));
    expect(calls[0]).toMatchObject({ method: 'POST', header: { 'Idempotency-Key': 'act_1' } });
    expect(calls[0]!.body).toMatchObject({
      taskTitle: 'Pour slab',
      crew: [{ personName: 'Dee' }, { personName: 'Lee' }],
    });
    expect(JSON.stringify(calls[0]!.body)).not.toContain('strokes');
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((p) => p.body)).toEqual([
      { signatureFileId: 'fil_act_1:0' },
      { signatureFileId: 'fil_act_1:1' },
    ]);
    // The second signature carries the version the first one produced.
    expect(puts[1]!.header).toEqual({ 'If-Match': '"2"' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { action: 'close' } });
  });

  it('does not sign someone twice when a replay carries on after a partial send', async () => {
    const { api, calls } = server({ alreadySigned: true });
    const upload = vi.fn(async () => 'fil_1');
    await createActionSender(api, 'org_1', { uploadSignature: upload })(action(payload(false)));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.some((c) => c.path.endsWith('/transition'))).toBe(false);
  });

  it('keeps a refused plan with the reason, and the queue lists it for the screen', async () => {
    const db = await nodeSqlDriver().open('pt2');
    await migrate(db);
    const { api } = server({ closeRefused: true });
    const q = new ActionQueue(
      db,
      createActionSender(api, 'org_1', { uploadSignature: async () => 'f' }),
    );
    await q.enqueue({
      id: 'act_9',
      projectId: 'prj_1',
      kind: 'pretask.submit',
      targetId: 'act_9',
      payload: payload(true),
    });
    expect(await q.drain()).toEqual({ sent: 0, refused: 1, retry: false });
    const [row] = await q.list('prj_1');
    expect(row).toMatchObject({ state: 'refused', kind: 'pretask.submit' });
    expect(row!.lastError).toContain('Cannot close');
  });
});
