// Composes every module's migrations into the single ordered history in /db/migrations (backend 01 §4).
// `--check` fails when /db/migrations is out of date (CI).
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COMPOSED_DIR, ROOT, sourceMigrations } from './sources';

const check = process.argv.includes('--check');
mkdirSync(COMPOSED_DIR, { recursive: true });

const expected = new Map<string, string>();
for (const m of sourceMigrations()) {
  const header = `-- Composed from ${relative(ROOT, m.path)} by tools/db/compose.ts. Edit the source, then run pnpm db:compose.\n`;
  expected.set(m.name, header + readFileSync(m.path, 'utf8'));
}

const existing = readdirSync(COMPOSED_DIR).filter((f) => f.endsWith('.sql'));
const problems: string[] = [];
for (const [name, content] of expected) {
  let current: string | null = null;
  try {
    current = readFileSync(join(COMPOSED_DIR, name), 'utf8');
  } catch {
    current = null;
  }
  if (current !== content) {
    problems.push(name);
    if (!check) writeFileSync(join(COMPOSED_DIR, name), content);
  }
}
for (const name of existing) {
  if (!expected.has(name)) {
    problems.push(`${name} (no source)`);
    if (!check) unlinkSync(join(COMPOSED_DIR, name));
  }
}

if (check && problems.length) {
  console.error(`db/migrations is stale: ${problems.join(', ')}. Run pnpm db:compose.`);
  process.exit(1);
}
console.log(
  check
    ? 'db/migrations is up to date.'
    : `Composed ${expected.size} migrations (${problems.length} changed).`,
);
