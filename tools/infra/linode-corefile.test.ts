import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import type { Allowlist } from './egress-allowlist';
import { renderCorefile } from './linode-corefile';

const list = parse(
  readFileSync(
    new URL('../../infra/envs/linode-pilot/egress-allowlist.yaml', import.meta.url),
    'utf8',
  ),
) as Allowlist;

test('only allow-listed hosts and the database resolve; everything else is NXDOMAIN', () => {
  const out = renderCorefile(list, ['private-a123.db.example.net']);
  assert.match(out, /^bedrock-runtime\.ap-southeast-2\.amazonaws\.com:53 \{/m);
  assert.match(out, /^private-a123\.db\.example\.net:53 \{/m);
  assert.doesNotMatch(out, /openai|anthropic\.com:53/);
  assert.match(out, /^\. \{\n {2}log[^\n]*\n {2}template ANY ANY \{\n {4}rcode NXDOMAIN/m);
});

test('refuses an invalid allow-list or extra host', () => {
  const bad: Allowlist = {
    ...list,
    restricted: [
      ...list.restricted,
      { host: 'api.openai.com', kind: 'ai', owner: 'x', used_by: 'api', reason: 'no' },
    ],
  };
  assert.throws(() => renderCorefile(bad), /invalid/);
  assert.throws(() => renderCorefile(list, ['evil.com:53 {\n']), /Not a hostname/);
});
