import { describe, expect, it } from 'vitest';
import { PHOTO_MODULES } from '../../src/application/files-service';

describe('project photo gallery sources', () => {
  it('never includes restricted records such as incidents or inductions', () => {
    for (const restricted of ['safety', 'workforce', 'documents', 'drawings'])
      expect(PHOTO_MODULES).not.toContain(restricted);
  });
});
