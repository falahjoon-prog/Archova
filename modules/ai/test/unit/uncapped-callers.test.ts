import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// `uncapped: true` on an embedding skips the org's daily cap (ai/05 §4). Sam's condition on the cap: only the induction
// publish may set it, because it is a few slides from one person's action. This fails when anything else does, so
// adding a caller is a decision someone reviews and changes here, not a flag copied from the one next to it.
const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('embeddings that skip the daily cap', () => {
  it('are requested only by the induction version index', () => {
    const setters = files(SRC)
      .filter((f) => /\buncapped\s*:\s*true\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(setters).toEqual(['application/induction-qa.ts']);
  });

  it('are never the default', () => {
    const gateway = readFileSync(join(SRC, 'application/gateway.ts'), 'utf8');
    expect(gateway).toMatch(/!opts\.uncapped/);
    expect(gateway).not.toMatch(/uncapped\s*[:=]\s*true/);
  });
});
