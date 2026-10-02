import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAllowlist, type Allowlist, type AllowlistEntry } from './egress-allowlist';

const denylist = [
  'openai.com',
  'chatgpt.com',
  'openai.azure.com',
  'cognitiveservices.azure.com',
  'anthropic.com',
  'claude.ai',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'cohere.com',
  'cohere.ai',
  'mistral.ai',
  'huggingface.co',
  'together.xyz',
  'together.ai',
  'groq.com',
  'perplexity.ai',
  'deepseek.com',
  'x.ai',
  'replicate.com',
  'fireworks.ai',
  'openrouter.ai',
];

const entry = (e: Partial<AllowlistEntry>): AllowlistEntry => ({
  host: 'abr.business.gov.au',
  kind: 'integration',
  owner: 'Ben',
  used_by: 'api',
  reason: 'test',
  ...e,
});
const list = (...restricted: AllowlistEntry[]): Allowlist => ({
  restricted,
  ai_vendor_denylist: denylist,
});

test('accepts Australian AI endpoints and ordinary integrations', () => {
  assert.deepEqual(
    checkAllowlist(
      list(
        entry({}),
        entry({
          host: 'bedrock-runtime.ap-southeast-2.amazonaws.com',
          kind: 'ai',
          region: 'ap-southeast-2',
        }),
        entry({
          host: 'bedrock-runtime.ap-southeast-4.amazonaws.com',
          kind: 'ai',
          region: 'ap-southeast-4',
        }),
        entry({ host: 'contoso-ae.openai.azure.com', kind: 'ai', region: 'australiaeast' }),
      ),
    ),
    [],
  );
});

test('rejects AI endpoints outside Australia', () => {
  const cases: AllowlistEntry[] = [
    entry({ host: 'bedrock-runtime.us-east-1.amazonaws.com', kind: 'ai', region: 'us-east-1' }),
    entry({
      host: 'bedrock-runtime.us-west-2.amazonaws.com',
      kind: 'ai',
      region: 'ap-southeast-2',
    }),
    entry({ host: 'api.openai.com', kind: 'ai', region: 'ap-southeast-2' }),
    entry({ host: 'api.anthropic.com', kind: 'ai', region: 'ap-southeast-2' }),
    entry({ host: 'contoso-us.openai.azure.com', kind: 'ai', region: 'eastus' }),
    entry({
      host: 'generativelanguage.googleapis.com',
      kind: 'ai',
      region: 'australia-southeast1',
    }),
  ];
  for (const c of cases) assert.notDeepEqual(checkAllowlist(list(c)), [], c.host);
});

test('rejects AI endpoints disguised as integrations', () => {
  assert.notDeepEqual(
    checkAllowlist(list(entry({ host: 'api.openai.com', kind: 'integration' }))),
    [],
  );
  assert.notDeepEqual(
    checkAllowlist(
      list(entry({ host: 'bedrock-runtime.ap-southeast-2.amazonaws.com', kind: 'platform' })),
    ),
    [],
  );
});

test('rejects wildcards, missing owners and duplicates', () => {
  assert.notDeepEqual(
    checkAllowlist(
      list(entry({ host: '*.openai.azure.com', kind: 'ai', region: 'australiaeast' })),
    ),
    [],
  );
  assert.notDeepEqual(checkAllowlist(list(entry({ owner: '' }))), []);
  assert.notDeepEqual(checkAllowlist(list(entry({}), entry({}))), []);
  assert.notDeepEqual(checkAllowlist(list(entry({ host: 'https://abr.business.gov.au/' }))), []);
});

test('the deny-list must cover every known AI vendor', () => {
  assert.notDeepEqual(checkAllowlist({ restricted: [], ai_vendor_denylist: ['openai.com'] }), []);
});
