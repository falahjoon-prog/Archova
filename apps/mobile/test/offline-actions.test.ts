import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { migrate } from '../lib/db';
import { ActionQueue, type ActionKind, type QueuedAction } from '../lib/actions/action-queue';
import { ACTION_TEXT } from '../lib/actions/attempt';
import { syncBadgeText } from '../lib/actions/badge-text';
import { createActionSender } from '../lib/actions/send';
import { nodeSqlDriver } from './support/node-sql';

interface Call {
  method: string;
  path: string;
  options: {
    params: { path: Record<string, string>; header?: Record<string, string> };
    body?: unknown;
  };
}

function fakeApi(talkVersion = 7) {
  const calls: Call[] = [];
  const reply = (method: string) => async (path: string, options: Call['options']) => {
    calls.push({ method, path, options });
    const data = path.endsWith('/toolbox-talks/{talkId}') ? { talk: { version: talkVersion } } : {};
    return { data, response: { ok: true, status: 200 } };
  };
  const api = { GET: reply('GET'), POST: reply('POST') } as unknown as ApiClient;
  return { api, calls };
}

const action = (
  kind: ActionKind,
  targetId: string,
  payload: Record<string, unknown>,
): QueuedAction => ({
  id: 'act_1',
  projectId: 'prj_1',
  kind,
  targetId,
  payload,
  state: 'pending',
  lastError: null,
  attempts: 0,
  createdAt: '2026-11-18T00:00:00.000Z',
});

describe('queued field actions are replayed through the online endpoints', () => {
  it('logs a delivery at the time it was tapped, not when the signal came back', async () => {
    const { api, calls } = fakeApi();
    await createActionSender(
      api,
      'org_1',
    )(action('delivery.checkIn', 'dlv_1', { event: 'arrived', at: '2026-11-18T01:02:03.000Z' }));
    expect(calls[0]).toMatchObject({ method: 'POST', path: expect.stringContaining('/check-in') });
    expect(calls[0]!.options.body).toEqual({ event: 'arrived', at: '2026-11-18T01:02:03.000Z' });
    expect(calls[0]!.options.params.path).toMatchObject({
      deliveryId: 'dlv_1',
      projectId: 'prj_1',
    });
  });

  it('acknowledges a SWMS with the queue id as the idempotency key', async () => {
    const { api, calls } = fakeApi();
    await createActionSender(
      api,
      'org_1',
    )(action('swms.acknowledge', 'sw_1', { workerName: 'Sam Site' }));
    expect(calls[0]!.options.params.header).toEqual({ 'Idempotency-Key': 'act_1' });
    expect(calls[0]!.options.body).toMatchObject({ workerName: 'Sam Site' });
  });

  it('sends the version the person saw, so a change made elsewhere is refused', async () => {
    const { api, calls } = fakeApi();
    const send = createActionSender(api, 'org_1');
    await send(action('permit.startRenewal', 'pmt_1', { version: 4 }));
    await send(action('environment.startCondition', 'cnd_1', { version: 2 }));
    await send(action('swms.transition', 'sw_1', { action: 'accept', version: 3 }));
    expect(calls.map((c) => c.options.params.header)).toEqual([
      { 'If-Match': '"4"' },
      { 'If-Match': '"2"' },
      { 'If-Match': '"3"' },
    ]);
    expect(calls[2]!.options.body).toMatchObject({
      action: 'accept',
      confirmedUnderstandable: true,
    });
  });

  it('adds a toolbox attendee against the talk’s current version', async () => {
    const { api, calls } = fakeApi(9);
    await createActionSender(
      api,
      'org_1',
    )(action('toolbox.addAttendee', 'tbt_1', { personName: 'Pat', userId: 'usr_1' }));
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1]!.options.params.header).toEqual({ 'If-Match': '"9"' });
    expect(calls[1]!.options.body).toEqual({ attendees: [{ personName: 'Pat', userId: 'usr_1' }] });
  });

  it('closes a toolbox talk', async () => {
    const { api, calls } = fakeApi();
    await createActionSender(
      api,
      'org_1',
    )(action('toolbox.transition', 'tbt_1', { action: 'close' }));
    expect(calls[1]!.options.body).toEqual({ action: 'close' });
  });

  it('has plain text for every kind', () => {
    for (const kind of [
      'delivery.checkIn',
      'swms.acknowledge',
      'swms.transition',
      'permit.startRenewal',
      'environment.startCondition',
      'toolbox.addAttendee',
      'toolbox.transition',
    ] as const) {
      expect(ACTION_TEXT[kind]).toBeTruthy();
    }
  });
});

describe('pending-sync counts', () => {
  it('counts waiting and refused actions across projects', async () => {
    const db = await nodeSqlDriver().open('counts.db');
    await migrate(db);
    const q = new ActionQueue(db, async (a) => {
      if (a.id === 'b') {
        const { ApiError } = await import('@archova/api-client');
        throw new ApiError(409, { title: 'x' } as never);
      }
    });
    const base = { kind: 'delivery.checkIn' as const, targetId: 't', payload: {} };
    expect(await q.counts()).toEqual({ pending: 0, refused: 0 });
    await q.enqueue({ id: 'a', projectId: 'p1', ...base });
    await q.enqueue({ id: 'b', projectId: 'p2', ...base });
    await q.enqueue({ id: 'c', projectId: 'p2', ...base });
    expect(await q.counts()).toEqual({ pending: 3, refused: 0 });
    await q.drain();
    expect(await q.counts()).toEqual({ pending: 0, refused: 1 });
  });

  it('words the indicator', () => {
    expect(syncBadgeText({ pending: 0, refused: 0 })).toBeNull();
    expect(syncBadgeText({ pending: 2, refused: 0 })).toBe('2 waiting to send');
    expect(syncBadgeText({ pending: 0, refused: 1 })).toBe('1 not accepted');
    expect(syncBadgeText({ pending: 2, refused: 1 })).toBe('2 waiting to send, 1 not accepted');
  });
});
