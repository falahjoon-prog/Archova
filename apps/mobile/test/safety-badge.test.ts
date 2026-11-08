import { describe, expect, it, vi } from 'vitest';
import {
  contactProblem,
  credentialLabel,
  expiryState,
  expiryText,
  initials,
  qrMatrix,
} from '../features/attendance';

vi.mock('../features/attendance/screens/SiteSignInScreen', () => ({}));
vi.mock('../features/attendance/screens/RollCallScreen', () => ({}));
vi.mock('../features/attendance/screens/SafetyBadgeScreen', () => ({}));

describe('initials', () => {
  it('uses the first and last name', () => {
    expect(initials('Jo Citizen')).toBe('JC');
    expect(initials('  maria  de la  cruz ')).toBe('MC');
    expect(initials('Cher')).toBe('C');
    expect(initials('   ')).toBe('?');
  });
});

describe('expiry', () => {
  it('flags expired, soon (30 days) and fine', () => {
    expect(expiryState(null, '2026-11-06')).toBe('none');
    expect(expiryState('2026-11-05', '2026-11-06')).toBe('expired');
    expect(expiryState('2026-11-06', '2026-11-06')).toBe('soon');
    expect(expiryState('2026-12-06', '2026-11-06')).toBe('soon');
    expect(expiryState('2026-12-07', '2026-11-06')).toBe('ok');
  });
  it('words it without claiming the card is verified', () => {
    expect(expiryText('2026-11-01', '2026-11-06')).toBe('Expired 2026-11-01');
    expect(expiryText(null, '2026-11-06')).toBe('No expiry date recorded');
    expect(credentialLabel('white_card')).toBe('White card');
    expect(credentialLabel('mystery')).toBe('Card');
  });
});

describe('contactProblem', () => {
  it('needs a name and a real phone number', () => {
    expect(contactProblem({ name: '', relationship: '', phone: '0412345678' })).toMatch(/name/);
    expect(contactProblem({ name: 'Sam', relationship: '', phone: '12' })).toMatch(/phone/);
    expect(contactProblem({ name: 'Sam', relationship: '', phone: '0412 345 678' })).toBeNull();
    expect(contactProblem({ name: 'Sam', relationship: '', phone: '+61 412 345 678' })).toBeNull();
  });
});

describe('qrMatrix', () => {
  it('is square with the finder pattern in the corner', () => {
    const m = qrMatrix('archova:badge:wkr_0123456789ABCDEFGHJKMNPQRS');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    expect(m[0]!.slice(0, 7).every(Boolean)).toBe(true);
  });
});
