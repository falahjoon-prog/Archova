// SQL for the deployed database roles (see roles.ts). Attributes match bootstrap-lib.ts for local and CI.
import type pg from 'pg';

export const ROLE_ATTRS: Record<string, string> = {
  app_migrator: 'LOGIN NOBYPASSRLS CREATEROLE',
  app_rw: 'LOGIN NOBYPASSRLS',
  app_platform: 'LOGIN NOBYPASSRLS',
  app_admin: 'LOGIN NOBYPASSRLS',
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Postgres string literal, the same escaping as pg's Client#escapeLiteral. */
export function literal(s: string): string {
  let hasBackslash = false;
  let out = "'";
  for (const c of s) {
    if (c === "'") out += "''";
    else if (c === '\\') {
      out += '\\\\';
      hasBackslash = true;
    } else out += c;
  }
  out += "'";
  return hasBackslash ? `E${out}` : out;
}

export async function roleStatements(
  client: Pick<pg.Client, 'query'>,
  roles: Array<{ name: string; password: string }>,
  dbName: string,
): Promise<string[]> {
  if (!IDENT.test(dbName)) throw new Error(`Bad database name ${dbName}`);
  const sql: string[] = [];
  for (const { name, password } of roles) {
    const attrs = ROLE_ATTRS[name];
    if (!attrs || !IDENT.test(name)) throw new Error(`Unknown role ${name}`);
    if (password.length < 20) throw new Error(`Password for ${name} is too short`);
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
    sql.push(
      `${exists.rowCount ? 'alter' : 'create'} role ${name} with ${attrs} password ${literal(password)}`,
    );
    sql.push(`grant connect on database ${dbName} to ${name}`);
  }
  // app_migrator owns every schema (backend 01 §4); nobody creates objects in public.
  sql.push(`grant create on database ${dbName} to app_migrator`);
  sql.push('create extension if not exists citext');
  sql.push('create extension if not exists pgcrypto');
  sql.push('revoke create on schema public from public');
  return sql;
}
