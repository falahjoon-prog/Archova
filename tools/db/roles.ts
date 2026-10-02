// Creates or updates the database roles in a deployed environment from their Secrets Manager secrets (infra
// modules/aurora/credentials.tf). Runs as a one-off ECS task before migrations, as the RDS-managed master user.
// Local and CI databases use bootstrap.ts instead.
//
// Env: DB_HOST, DB_NAME, and from Secrets Manager (ECS injects each whole secret) DB_MASTER_SECRET =
// {"username","password",...} and DB_ROLE_<ROLE> = {"username","password",...} for every role in ROLE_ATTRS.
import pg from 'pg';
import { ROLE_ATTRS, roleStatements } from './roles-lib';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const master = JSON.parse(need('DB_MASTER_SECRET')) as { username: string; password: string };
const roles = Object.keys(ROLE_ATTRS).map((name) => {
  const secret = JSON.parse(need(`DB_ROLE_${name.toUpperCase()}`)) as { password: string };
  return { name, password: secret.password };
});
const dbName = need('DB_NAME');

const client = new pg.Client({
  host: need('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 5432),
  database: dbName,
  user: master.username,
  password: master.password,
  ssl: process.env.DB_SSL !== 'false', // verified against the RDS CA (NODE_EXTRA_CA_CERTS in the image)
});
await client.connect();
try {
  for (const sql of await roleStatements(client, roles, dbName)) await client.query(sql);
  console.log(`Roles ready: ${roles.map((r) => r.name).join(', ')}`);
} finally {
  await client.end();
}
