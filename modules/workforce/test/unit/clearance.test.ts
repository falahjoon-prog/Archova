import { describe, expect, it } from 'vitest';
import { evaluateClearance, type ClearanceFacts } from '../../src/domain/clearance';

const base: ClearanceFacts = {
  today: '2026-11-07',
  workerActive: true,
  credentials: [{ kind: 'white_card', expiresOn: null }],
  inductionReasons: [],
  swms: [{ number: 1, title: 'Wiring', status: 'accepted', expired: false, acknowledged: true }],
};
const status = (f: ClearanceFacts, key: string) =>
  evaluateClearance(f).checks.find((c) => c.key === key)!.status;

describe('evaluateClearance', () => {
  it('clears a worker with everything in place and no flag', () => {
    const r = evaluateClearance(base);
    expect(r.result).toBe('cleared');
    expect(r.flag).toBeNull();
  });

  it('blocks on a missing induction and flags it first', () => {
    const r = evaluateClearance({
      ...base,
      inductionReasons: [{ code: 'induction.missing', blocking: true }],
    });
    expect(r.result).toBe('blocked');
    expect(r.flag?.severity).toBe('blocking');
    expect(r.flag?.title).toContain('Site induction');
  });

  it('blocks on an expired white card, warns when it is about to expire', () => {
    const expired = { ...base, credentials: [{ kind: 'white_card', expiresOn: '2026-11-01' }] };
    expect(status(expired, 'white_card')).toBe('fail');
    const soon = { ...base, credentials: [{ kind: 'white_card', expiresOn: '2026-11-20' }] };
    expect(status(soon, 'white_card')).toBe('warn');
    expect(evaluateClearance(soon).result).toBe('warning');
  });

  it('blocks on a missing white card', () => {
    expect(status({ ...base, credentials: [] }, 'white_card')).toBe('fail');
    expect(
      status(
        { ...base, inductionReasons: [{ code: 'white_card.missing', blocking: true }] },
        'white_card',
      ),
    ).toBe('fail');
  });

  it('blocks on an expired licence but not on one with no expiry', () => {
    const lic = (expiresOn: string | null) => ({
      ...base,
      credentials: [...base.credentials, { kind: 'high_risk_licence', expiresOn }],
    });
    expect(status(lic('2026-10-01'), 'licences')).toBe('fail');
    expect(status(lic(null), 'licences')).toBe('na');
    expect(status(lic('2027-06-01'), 'licences')).toBe('pass');
  });

  it('needs the worker to have acknowledged an accepted SWMS', () => {
    const unread = { ...base, swms: [{ ...base.swms[0]!, acknowledged: false }] };
    const r = evaluateClearance(unread);
    expect(r.result).toBe('blocked');
    expect(r.flag?.suggestedAction).toMatch(/acknowledge the SWMS/);
  });

  it('treats an expired or unaccepted company SWMS as a warning, and no SWMS as not applicable', () => {
    expect(status({ ...base, swms: [{ ...base.swms[0]!, expired: true }] }, 'swms')).toBe('warn');
    expect(status({ ...base, swms: [] }, 'swms')).toBe('na');
  });

  it('skips the induction check when the project has no site', () => {
    expect(status({ ...base, inductionReasons: null }, 'induction')).toBe('na');
  });

  it('blocks an inactive worker', () => {
    expect(evaluateClearance({ ...base, workerActive: false }).result).toBe('blocked');
  });
});
