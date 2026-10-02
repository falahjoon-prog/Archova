// pnpm check:egress: validates every infra/envs/*/egress-allowlist.yaml (X25, X28; infrastructure/01 §3.1).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkAllowlist, type Allowlist } from './egress-allowlist';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENVS = join(ROOT, 'infra/envs');

let failed = false;
let checked = 0;
for (const env of readdirSync(ENVS).sort()) {
  const file = join(ENVS, env, 'egress-allowlist.yaml');
  if (!existsSync(join(ENVS, env, 'main.tf'))) continue;
  // Every AWS cell needs one; other environments (the Linode option) are checked when they have one.
  const usesCell = readFileSync(join(ENVS, env, 'main.tf'), 'utf8').includes('cells/cell');
  if (!usesCell && !existsSync(file)) continue;
  if (!existsSync(file)) {
    console.error(`infra/envs/${env}: egress-allowlist.yaml is missing`);
    failed = true;
    continue;
  }
  const errors = checkAllowlist(parse(readFileSync(file, 'utf8')) as Allowlist);
  checked++;
  for (const e of errors) console.error(`infra/envs/${env}/egress-allowlist.yaml: ${e}`);
  if (errors.length) failed = true;
}

if (failed) process.exit(1);
console.log(`Egress allow-lists OK (${checked} environments).`);
