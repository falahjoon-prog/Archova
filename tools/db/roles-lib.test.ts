import assert from 'node:assert/strict';
import { test } from 'node:test';
import { literal, roleStatements } from './roles-lib';

const fakeClient = (existing: string[]) => ({
  query: async (_sql: string, params?: unknown[]) => ({
    rowCount: existing.includes(String(params?.[0])) ? 1 : 0,
  }),
});

test('literal escapes quotes and backslashes', () => {
  assert.equal(literal("a'b"), "'a''b'");
  assert.equal(literal('a\\b'), "E'a\\\\b'");
});

test('creates missing roles and alters existing ones', async () => {
  const pw = 'x'.repeat(40);
  const sql = await roleStatements(
    fakeClient(['app_rw']) as never,
    [
      { name: 'app_migrator', password: pw },
      { name: 'app_rw', password: pw },
    ],
    'archova',
  );
  assert.ok(
    sql.includes(`create role app_migrator with LOGIN NOBYPASSRLS CREATEROLE password '${pw}'`),
  );
  assert.ok(sql.includes(`alter role app_rw with LOGIN NOBYPASSRLS password '${pw}'`));
  assert.ok(sql.includes('grant create on database archova to app_migrator'));
  assert.ok(!sql.some((s) => /bypassrls/.test(s) && !/NOBYPASSRLS/.test(s)));
});

test('refuses unknown roles, bad database names and short passwords', async () => {
  const c = fakeClient([]) as never;
  await assert.rejects(
    roleStatements(c, [{ name: 'postgres', password: 'x'.repeat(40) }], 'archova'),
  );
  await assert.rejects(roleStatements(c, [], 'archova; drop'));
  await assert.rejects(roleStatements(c, [{ name: 'app_rw', password: 'short' }], 'archova'));
});
