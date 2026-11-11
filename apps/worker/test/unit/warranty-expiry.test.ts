import { describe, expect, it } from 'vitest';
import { reminderText } from '../../src/jobs/warranty-expiry';

describe('reminderText', () => {
  it('words each reminder day in plain language', () => {
    expect(reminderText('Roof membrane', '2027-01-31', 90).title).toBe(
      'Roof membrane warranty ends in 90 days',
    );
    expect(reminderText('Roof membrane', '2027-01-31', 7).body).toContain('2027-01-31');
    expect(reminderText('Roof membrane', '2027-01-31', 0).title).toBe(
      'Roof membrane warranty has ended',
    );
  });
});
