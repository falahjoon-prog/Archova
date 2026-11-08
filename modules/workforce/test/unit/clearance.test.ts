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

  describe('company insurance', () => {
    const ins = (
      state: 'cleared' | 'warning' | 'blocked',
      messages: { level: 'blocking' | 'warning'; text: string }[] = [],
      checked = true,
    ) => ({ ...base, insurance: { state, checked, messages } });

    it('is not applicable without a company or without anything to check', () => {
      expect(status(base, 'insurance')).toBe('na');
      expect(status(ins('cleared', [], false), 'insurance')).toBe('na');
      expect(evaluateClearance(ins('cleared', [], false)).result).toBe('cleared');
    });
    it('passes when certificates and bonds are in date', () => {
      expect(status(ins('cleared'), 'insurance')).toBe('pass');
    });
    it('warns without blocking when a certificate is about to expire', () => {
      const r = evaluateClearance(
        ins('warning', [{ level: 'warning', text: 'INS-0001 expires in 9 days.' }]),
      );
      expect(r.result).toBe('warning');
      expect(r.checks.find((c) => c.key === 'insurance')!.detail).toBe(
        'INS-0001 expires in 9 days',
      );
    });
    it('blocks the worker when the company has an expired or missing certificate', () => {
      const r = evaluateClearance(
        ins('blocked', [
          { level: 'blocking', text: 'No workers compensation insurance on the register.' },
          { level: 'warning', text: 'Public liability is below the minimum.' },
        ]),
      );
      expect(r.result).toBe('blocked');
      expect(r.flag?.title).toContain('Company insurance');
      expect(r.flag?.suggestedAction).toContain('current certificate or bond');
      expect(r.checks.find((c) => c.key === 'insurance')!.detail).not.toContain('minimum');
    });
  });
});
