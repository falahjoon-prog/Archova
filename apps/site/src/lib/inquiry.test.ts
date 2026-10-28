import { describe, expect, it } from 'vitest';
import { readInquiry, validateInquiry } from './inquiry';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('demo request validation', () => {
  it('accepts a complete request', () => {
    const i = readInquiry(form({ name: ' Sam ', email: 'sam@build.com.au', consent: 'on' }));
    expect(i.name).toBe('Sam');
    expect(validateInquiry(i)).toEqual({});
  });
  it('flags missing name, bad email and no consent', () => {
    expect(validateInquiry(readInquiry(form({ email: 'nope' })))).toEqual({
      name: expect.any(String),
      email: expect.any(String),
      consent: expect.any(String),
    });
  });
  it('trims overlong fields', () => {
    expect(readInquiry(form({ message: 'x'.repeat(5000) })).message).toHaveLength(2000);
  });
});
