import { readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const COMPOSED_DIR = join(ROOT, 'db/migrations');

const FILE_RE = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** Module-owned migration files: packages/kernel/db/migrations and modules/<name>/db/migrations. */
export function sourceMigrations(): Array<{ name: string; path: string; owner: string }> {
  const dirs: Array<{ owner: string; dir: string }> = [
    { owner: 'kernel', dir: join(ROOT, 'packages/kernel/db/migrations') },
  ];
  for (const mod of readdirSync(join(ROOT, 'modules'))) {
    dirs.push({ owner: mod, dir: join(ROOT, 'modules', mod, 'db/migrations') });
  }
  const out: Array<{ name: string; path: string; owner: string }> = [];
  for (const { owner, dir } of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.sql')) continue;
      if (!FILE_RE.test(name))
        throw new Error(`Migration name must be <yyyymmddhhmmss>_<name>.sql: ${owner}/${name}`);
      out.push({ name, path: join(dir, name), owner });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  for (const m of out) {
    const ts = m.name.slice(0, 14);
    if (seen.has(ts)) throw new Error(`Duplicate migration timestamp ${ts}`);
    seen.add(ts);
  }
  return out;
}
