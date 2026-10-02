import { describe, expect, it } from 'vitest';
import { contentDisposition, hexToBase64, storageKey } from '../../src/domain/rules';

describe('storage keys', () => {
  it('follow orgs/{orgId}/projects/{projectId}/{module}/{fileId}/original (X22)', () => {
    expect(storageKey({ orgId: 'o', projectId: 'p', module: 'documents', fileId: 'f' })).toBe(
      'orgs/o/projects/p/documents/f/original',
    );
    expect(storageKey({ orgId: 'o', projectId: null, module: 'platform', fileId: 'f' })).toBe(
      'orgs/o/_org/platform/f/original',
    );
  });
  it('rejects module names that could escape the prefix', () => {
    expect(() =>
      storageKey({ orgId: 'o', projectId: null, module: '../x', fileId: 'f' }),
    ).toThrow();
  });
});

describe('content disposition', () => {
  it('quotes safely and keeps the UTF-8 name', () => {
    expect(contentDisposition('Level 2 "A".pdf')).toBe(
      `attachment; filename="Level 2 _A_.pdf"; filename*=UTF-8''Level%202%20%22A%22.pdf`,
    );
    expect(contentDisposition('café.pdf')).toContain("filename*=UTF-8''caf%C3%A9.pdf");
  });
});

describe('checksums', () => {
  it('converts hex SHA-256 to base64', () => {
    const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(hexToBase64(hex)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});
