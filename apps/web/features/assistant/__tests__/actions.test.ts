import { describe, expect, it } from 'vitest';
import { actionRedirect } from '../data/actions';

describe('Ask Nova action requests', () => {
  it('points at the Draft with Nova button on the induction page', () => {
    const a = actionRedirect('make me an induction', { record: { type: 'induction', id: 'i1' } });
    expect(a?.kind).toBe('answer');
    expect(a?.text).toMatch(/draft it now/);
  });
  it('says where to go from elsewhere', () => {
    expect(actionRedirect('Draft an induction', {})?.text).toMatch(/Inductions screen/);
  });
  it('leaves ordinary questions alone', () => {
    expect(actionRedirect('how many open RFIs?', {})).toBeNull();
    expect(actionRedirect('what does the induction say about hot work', {})).toBeNull();
  });
});

describe('Ask Nova action button', () => {
  it('offers to run the draft only where the screen can do it', () => {
    expect(
      actionRedirect('make me an induction', { record: { type: 'induction', id: 'i1' } })?.action,
    ).toEqual({
      id: 'draft',
      label: 'Draft with Nova',
    });
    expect(actionRedirect('make me an induction', {})?.action).toBeUndefined();
  });
});
