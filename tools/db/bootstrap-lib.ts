// Creates the database roles (Sam 03 §3, backend 02 §2) and a database, for local dev and CI only.
import pg from 'pg';

// Dev-only passwords. Never used outside local and CI; deployed roles are managed by infra.
const ROLES: Array<{ name: string; attrs: string }> = [
  { name: 'app_migrator', attrs: 'LOGIN NOBYPASSRLS CREATEROLE' },
  { name: 'app_rw', attrs: 'LOGIN NOBYPASSRLS' },
  { name: 'app_platform', attrs: 'LOGIN NOBYPASSRLS' },
];

export async function bootstrapDatabase(
  adminUrl: string,
  dbName: string,
  opts: { reset?: boolean } = {},
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Bad database name ${dbName}`);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const role of ROLES) {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role.name]);
      const verb = exists.rowCount ? 'alter' : 'create';
      await client.query(`${verb} role ${role.name} with ${role.attrs} password '${role.name}'`);
    }
    if (opts.reset) await client.query(`drop database if exists ${dbName} with (force)`);
    const db = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!db.rowCount) await client.query(`create database ${dbName} owner app_migrator`);
  } finally {
    await client.end();
  }
  // Extensions that need a superuser are created here; migrations only reference them.
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const dbClient = new pg.Client({ connectionString: url.toString() });
  await dbClient.connect();
  try {
    await dbClient.query('create extension if not exists citext');
    await dbClient.query('create extension if not exists pgcrypto');
    // pgvector for Nova retrieval (ai/03 §5); RDS for PostgreSQL 16 ships it.
    await dbClient.query('create extension if not exists vector');
    await dbClient.query('revoke create on schema public from public');
  } finally {
    await dbClient.end();
  }
}
