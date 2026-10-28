import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corsRules } from './linode-cors';

test('uploads may PUT and the viewers may range-read, from the app origin only', () => {
  const { CORSRules } = corsRules('app.example.com.au');
  assert.deepEqual(
    CORSRules.map((r) => r.AllowedMethods),
    [['PUT'], ['GET', 'HEAD']],
  );
  for (const r of CORSRules) assert.deepEqual(r.AllowedOrigins, ['https://app.example.com.au']);
  assert.ok(CORSRules[1]!.ExposeHeaders.includes('content-range'));
});

test('refuses something that is not a host name', () => {
  assert.throws(() => corsRules('app.example.com/"'), /host name/);
});
