import { describe, expect, it } from 'vitest';
import {
  blockingHold,
  canComplete,
  progress,
  templateFor,
  type ItemState,
} from '../../src/domain/itp';

const item = (
  id: string,
  sort: number,
  pointType: ItemState['pointType'],
  status: ItemState['status'] = 'pending',
): ItemState => ({
  id,
  sort,
  pointType,
  status,
});

describe('blockingHold', () => {
  const items = [item('a', 1, 'hold'), item('b', 2, 'witness'), item('c', 3, 'hold')];
  it('blocks a later point while an earlier hold point is open', () => {
    expect(blockingHold(items, 'b')?.id).toBe('a');
    expect(blockingHold(items, 'c')?.id).toBe('a');
  });
  it('never blocks the first point, and witness points do not block', () => {
    expect(blockingHold(items, 'a')).toBeNull();
    expect(blockingHold([item('a', 1, 'witness'), item('b', 2, 'hold')], 'b')).toBeNull();
  });
  it('releases once the hold point is passed or waived', () => {
    expect(blockingHold([item('a', 1, 'hold', 'passed'), item('b', 2, 'hold')], 'b')).toBeNull();
    expect(blockingHold([item('a', 1, 'hold', 'waived'), item('b', 2, 'hold')], 'b')).toBeNull();
  });
  it('keeps blocking while an earlier hold point has failed', () => {
    expect(blockingHold([item('a', 1, 'hold', 'failed'), item('b', 2, 'hold')], 'b')?.id).toBe('a');
  });
});

describe('completion', () => {
  it('needs at least one point and nothing pending or failed', () => {
    expect(canComplete([])).toBe(false);
    expect(canComplete([item('a', 1, 'hold', 'passed'), item('b', 2, 'witness', 'waived')])).toBe(
      true,
    );
    expect(canComplete([item('a', 1, 'hold', 'passed'), item('b', 2, 'witness', 'failed')])).toBe(
      false,
    );
    expect(canComplete([item('a', 1, 'hold', 'passed'), item('b', 2, 'witness')])).toBe(false);
  });
  it('counts progress', () => {
    expect(
      progress([
        item('a', 1, 'hold', 'passed'),
        item('b', 2, 'hold'),
        item('c', 3, 'witness', 'failed'),
      ]),
    ).toEqual({ total: 3, done: 1, failed: 1, holdOpen: 1 });
  });
});

describe('templateFor', () => {
  it('matches the discipline loosely and falls back to a general starter', () => {
    expect(templateFor('Structural concrete').key).toBe('concrete');
    expect(templateFor('Fire stopping').key).toBe('fire');
    expect(templateFor(null).key).toBe('general');
    expect(templateFor('Joinery').items.length).toBeGreaterThan(0);
  });
});
