import { describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/queues';
import { subscriberJobId, subscribersFor, type Subscriber } from '../../src/subscribers';

const sub = (name: string, ...types: string[]): Subscriber => ({
  name,
  types,
  handle: async () => {},
});

describe('subscribersFor', () => {
  const registry = [
    sub('audit', '*'),
    sub('defects', 'defects.*'),
    sub('exact', 'rfis.rfi.created.v1'),
  ];

  it('matches exact types, prefixes and the catch-all', () => {
    expect(subscribersFor(registry, 'defects.defect.created.v1').map((s) => s.name)).toEqual([
      'audit',
      'defects',
    ]);
    expect(subscribersFor(registry, 'rfis.rfi.created.v1').map((s) => s.name)).toEqual([
      'audit',
      'exact',
    ]);
    expect(subscribersFor(registry, 'rfis.rfi.closed.v1').map((s) => s.name)).toEqual(['audit']);
  });

  it('rejects duplicate names', () => {
    expect(() => subscribersFor([sub('a', '*'), sub('a', 'x.*')], 'x.y.v1')).toThrow(/Duplicate/);
  });
});

describe('dispatch', () => {
  it('adds one job per subscriber with a deterministic id', async () => {
    const addBulk = vi.fn(async () => []);
    const event = { id: 'e1', orgId: 'o1', type: 'defects.defect.created.v1' };
    const n = await dispatch(event, [sub('audit', '*'), sub('rfis', 'rfis.*')], {
      addBulk,
    } as never);
    expect(n).toBe(1);
    const jobs = (addBulk.mock.calls as unknown as unknown[][])[0]![0] as Array<{
      name: string;
      opts: { jobId: string };
    }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.opts.jobId).toBe(subscriberJobId('e1', 'audit'));
  });

  it('adds nothing when no subscriber matches', async () => {
    const addBulk = vi.fn(async () => []);
    const n = await dispatch({ id: 'e', orgId: 'o', type: 'x.y.v1' }, [], { addBulk } as never);
    expect(n).toBe(0);
    expect(addBulk).not.toHaveBeenCalled();
  });
});
