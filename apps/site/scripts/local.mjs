// One command to run the website on your own computer: `pnpm site:local` from the repo root.
// Keeps a private session secret and the database under apps/site/data/, adds starter content once, then serves the site.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data');
mkdirSync(data, { recursive: true });
const secretFile = join(data, '.secret');
if (!existsSync(secretFile))
  writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const env = { ...process.env, SITE_PAYLOAD_SECRET: readFileSync(secretFile, 'utf8').trim() };

const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...env, ...extra },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('pnpm', ['seed']);
run('pnpm', ['build']);
console.log('\nWebsite: http://localhost:3007   Editor: http://localhost:3007/cms');
console.log('Sign in to the editor with admin@archova.local / Archova-Local-1 (local only)\n');
run('pnpm', ['start']);
