import { describe, expect, it } from 'vitest';
import {
  availableObservationActions,
  canSeeObservation,
  observationTransition,
} from '../../src/domain/observation';

const viewer = (over = {}) => ({ userId: 'u1', companyId: 'c1', isInternal: false, ...over });
const obs = (over = {}) => ({
  status: 'open' as const,
  type: 'safety' as const,
  swmsId: null,
  assigneeCompanyId: 'c1',
  raisedByCompanyId: null,
  createdBy: 'u9',
  ...over,
});

describe('observation lifecycle', () => {
  it('resolves, closes and reopens', () => {
    expect(observationTransition('open', 'resolve', null)).toEqual({ ok: true, to: 'resolved' });
    expect(observationTransition('resolved', 'close', null)).toEqual({ ok: true, to: 'closed' });
    expect(observationTransition('closed', 'reopen', 'Still leaking')).toEqual({
      ok: true,
      to: 'open',
    });
  });
  it('needs a reason to reopen or stop work', () => {
    expect(observationTransition('resolved', 'reopen', ' ')).toEqual({
      ok: false,
      code: 'observation.reason_required',
    });
    expect(observationTransition('open', 'stopWork', null).ok).toBe(false);
    expect(observationTransition('open', 'stopWork', 'Harnesses not worn')).toEqual({
      ok: true,
      to: 'open',
    });
  });
  it('refuses moves the state does not allow', () => {
    expect(observationTransition('closed', 'resolve', null).ok).toBe(false);
    expect(observationTransition('resolved', 'stopWork', 'x').ok).toBe(false);
  });
});

describe('who sees and acts', () => {
  it('shows the assigned company, the raiser and builder staff', () => {
    expect(canSeeObservation(obs(), viewer())).toBe(true);
    expect(canSeeObservation(obs({ assigneeCompanyId: 'c2' }), viewer())).toBe(false);
    expect(canSeeObservation(obs({ assigneeCompanyId: 'c2', createdBy: 'u1' }), viewer())).toBe(
      true,
    );
    expect(canSeeObservation(obs({ assigneeCompanyId: 'c2' }), viewer({ isInternal: true }))).toBe(
      true,
    );
  });
  it('lets the assignee resolve but not close', () => {
    const caps = { create: true, close: false };
    expect(availableObservationActions(obs(), viewer(), caps)).toEqual(['resolve', 'stopWork']);
    expect(availableObservationActions(obs({ assigneeCompanyId: 'c2' }), viewer(), caps)).toEqual([
      'stopWork',
    ]);
    expect(
      availableObservationActions(obs({ status: 'resolved' }), viewer({ isInternal: true }), {
        create: true,
        close: true,
      }),
    ).toEqual(['close', 'reopen']);
  });
});
