import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0007 amendment 1 (Sam, items 4 and 5): the contractor-scope transaction and the self-scope reads of links live
// in one repository file, which selects named columns. Nothing else may open them.
const ROOT = resolve(__dirname, '../../../..');
const REPO = 'modules/contractors/src/infra/links-repo.ts';

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === 'generated')
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes('/test/'))
      out.push(p);
  }
  return out;
}

describe('contractor scope boundaries', () => {
  const files = ['modules', 'packages', 'apps'].flatMap((d) => sources(join(ROOT, d)));

  it('only the links repository calls withContractorTx', () => {
    const users = files
      .filter((f) => readFileSync(f, 'utf8').includes('withContractorTx'))
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== 'packages/kernel/src/db.ts');
    expect(users).toEqual([REPO]);
  });

  it('no other module reads or writes the contractors schema', () => {
    const outsiders = files
      .map((f) => relative(ROOT, f))
      .filter((f) => !f.startsWith('modules/contractors/') && f !== 'packages/kernel/src/db.ts')
      .filter((f) =>
        /contractors\.(links|link_decisions|directory|profiles)/.test(
          readFileSync(join(ROOT, f), 'utf8'),
        ),
      );
    expect(outsiders).toEqual([]);
  });

  it('the links repository never selects every column', () => {
    const src = readFileSync(join(ROOT, REPO), 'utf8');
    expect(src).toContain('SELF_COLUMNS');
    expect(src).not.toMatch(/withSelfTx\([^)]*\)[\s\S]{0,80}\.select\(\)/);
  });
});
