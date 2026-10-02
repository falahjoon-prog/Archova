import { describe, expect, it } from 'vitest';
import { decodeId, encodeId, isUuid, uuidv7 } from '../src';

describe('uuidv7', () => {
  it('produces version 7, variant 10 UUIDs', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is strictly increasing within one millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7(1_800_000_000_000));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  it('is time ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });
});

describe('prefixed ids', () => {
  it('round-trips', () => {
    const uuid = uuidv7();
    const id = encodeId('project', uuid);
    expect(id).toMatch(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(decodeId('project', id)).toBe(uuid);
  });

  it('keeps sort order of the underlying UUIDv7', () => {
    const a = encodeId('rfi', uuidv7(1_700_000_000_000));
    const b = encodeId('rfi', uuidv7(1_700_000_100_000));
    expect(a < b).toBe(true);
  });

  it('rejects the wrong prefix and malformed bodies', () => {
    const id = encodeId('org', uuidv7());
    expect(decodeId('project', id)).toBeNull();
    expect(decodeId('org', 'org_short')).toBeNull();
    expect(decodeId('org', 'org_UUUUUUUUUUUUUUUUUUUUUUUUUU')).toBeNull();
    expect(decodeId('org', 'org_ZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull();
  });

  it('accepts lower case and Crockford aliases', () => {
    const uuid = '00000000-0000-7000-8000-000000000001';
    const id = encodeId('user', uuid);
    expect(decodeId('user', id.toLowerCase())).toBe(uuid);
    expect(decodeId('user', id.replace(/0/g, 'O'))).toBe(uuid);
  });
});
