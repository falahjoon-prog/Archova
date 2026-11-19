import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The financials function behind the client link does no permission check, because the link has already been
// authorised. It must never be reachable from a route.
describe('approvedClientChanges', () => {
  it('is not referenced by any route file in any module', () => {
    const modules = join(__dirname, '../../..');
    const hits: string[] = [];
    for (const m of readdirSync(modules)) {
      const api = join(modules, m, 'src', 'api');
      let files: string[] = [];
      try {
        files = readdirSync(api);
      } catch {
        continue;
      }
      for (const f of files)
        if (/approvedClientChanges/.test(readFileSync(join(api, f), 'utf8')))
          hits.push(`${m}/${f}`);
    }
    expect(hits).toEqual([]);
  });
});
