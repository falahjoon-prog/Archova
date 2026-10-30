// The files the Linode option's deploy pipeline writes on each app server (infrastructure/10, tools/infra/linode-deploy.sh),
// from `terraform output -json` of infra/envs/linode-pilot plus the release's image tag and the JWT signing key:
//   /opt/archova/.env    compose interpolation: image tag, addresses, Roles Anywhere ARNs
//   /etc/archova/*.env   one env file per container; the database, Valkey and storage secrets live only here
//   /etc/archova/Corefile, db-ca.pem
// The primary server (index 0) also gets Valkey's, the backup job's and the database admin's files; the others
// don't, so a second server holds no admin or backup credentials.
//
// pnpm infra:linode-host-files <outputs.json> <server index> <image tag> <out dir>
//   with LINODE_JWT_PRIVATE_JWK (and optionally BACKUP_ALERT_URL) in the environment.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { Allowlist } from './egress-allowlist';
import { renderCorefile } from './linode-corefile';

interface Bucket {
  name: string;
  endpoint: string;
}

/** The parts of `terraform output -json` this reads (infra/envs/linode-pilot/outputs.tf). */
export interface LinodeOutputs {
  hosts: { value: { app: string; api: string } };
  app_servers: { value: Array<{ label: string; public: string; vpc: string }> };
  files_bucket: { value: Bucket };
  backups_bucket: { value: Bucket };
  roles_anywhere: { value: { trust_anchor_arn: string; profile_arn: string; role_arn: string } };
  deploy: {
    value: {
      backup_age_recipient: string;
      ai_models: { fast: string; standard: string; advanced: string };
    };
  };
  host_secrets: {
    value: {
      database_host: string;
      database_port: number;
      database_admin_user: string;
      database_admin_pass: string;
      database_ca: string;
      database_name: string;
      database_roles: Record<string, string>;
      valkey_password: string;
      valkey_host: string;
      files_key_id: string;
      files_key_secret: string;
      backup_key_id: string;
      backup_key_secret: string;
    };
  };
}

export interface HostFilesInput {
  outputs: LinodeOutputs;
  allowlist: Allowlist;
  server: number;
  imageTag: string;
  jwtPrivateJwk: string;
  backupAlertUrl?: string;
}

/** Relative paths: `opt/` goes to /opt/archova, `etc/` to /etc/archova. */
export type HostFiles = Record<string, string>;

const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** One env file line. Values are single-quoted, which compose reads literally (no interpolation). */
function line(key: string, value: string | number): string {
  const v = String(value);
  if (/['\n\r]/.test(v)) throw new Error(`${key} can't contain a quote or a line break`);
  return `${key}='${v}'`;
}

function envFile(vars: Record<string, string | number | undefined>): string {
  return (
    Object.entries(vars)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
      .map(([k, v]) => line(k, v))
      .join('\n') + '\n'
  );
}

/** Linode Object Storage signs with the cluster id in its endpoint (ap-southeast-1.linodeobjects.com). */
export function storageRegion(endpoint: string): string {
  const host = new URL(endpoint).hostname;
  const m = /^([a-z]{2}-[a-z]+-\d+)\.linodeobjects\.com$/.exec(host);
  if (!m) throw new Error(`Not a Linode Object Storage endpoint: ${endpoint}`);
  return m[1]!;
}

export function renderHostFiles(input: HostFilesInput): HostFiles {
  const o = input.outputs;
  const s = o.host_secrets.value;
  const servers = o.app_servers.value;
  const server = servers[input.server];
  if (!server) throw new Error(`No app server ${input.server} (there are ${servers.length})`);
  if (!TAG.test(input.imageTag)) throw new Error(`Not an image tag: ${input.imageTag}`);
  JSON.parse(input.jwtPrivateJwk); // fail here, not when the api starts
  const primary = input.server === 0;
  const { app, api } = o.hosts.value;
  const db = (user: string, password: string) =>
    `postgres://${user}:${encodeURIComponent(password)}@${s.database_host}:${s.database_port}/${s.database_name}?sslmode=verify-full`;
  const role = (name: string) => {
    const pw = s.database_roles[name];
    if (!pw) throw new Error(`No password for database role ${name}`);
    return pw;
  };
  const files = o.files_bucket.value;
  const backups = o.backups_bucket.value;
  const ra = o.roles_anywhere.value;
  const models = o.deploy.value.ai_models;

  const out: HostFiles = {
    'opt/.env': envFile({
      IMAGE_TAG: input.imageTag,
      VPC_IP: server.vpc,
      APP_HOST: app,
      API_HOST: api,
      RA_TRUST_ANCHOR_ARN: ra.trust_anchor_arn,
      RA_PROFILE_ARN: ra.profile_arn,
      RA_ROLE_ARN: ra.role_arn,
    }),
    // Same settings as the api's ECS task on AWS (infra/cells/cell/services.tf), with Linode's storage and ClamAV.
    'etc/api.env': envFile({
      NODE_ENV: 'production',
      API_PORT: 4000,
      API_APP_ORIGINS: `https://${app}`,
      API_PUBLIC_HOSTS: api,
      API_WEB_SIGN_IN_URL: `https://${app}/login`,
      API_JWT_ISSUER: `https://${api}`,
      // The NodeBalancer and Caddy pass the viewer's Host through unchanged.
      API_TRUST_PROXY: 'false',
      API_DATABASE_URL: db('app_rw', role('app_rw')),
      API_REDIS_URL: `redis://:${encodeURIComponent(s.valkey_password)}@${s.valkey_host}:6379`,
      API_JWT_PRIVATE_JWK: input.jwtPrivateJwk,
      API_FILES_STORE: 's3',
      API_FILES_BUCKET: files.name,
      API_FILES_REGION: storageRegion(files.endpoint),
      API_S3_ENDPOINT: files.endpoint,
      API_S3_ACCESS_KEY_ID: s.files_key_id,
      API_S3_SECRET_ACCESS_KEY: s.files_key_secret,
      API_AI_PROVIDER: 'bedrock',
      API_AI_REGION: 'ap-southeast-2',
      API_AI_MODEL_FAST: models.fast,
      API_AI_MODEL_STANDARD: models.standard,
      API_AI_MODEL_ADVANCED: models.advanced,
      LOG_LEVEL: 'info',
    }),
    'etc/web.env': envFile({ NODE_ENV: 'production', PORT: 3000, HOSTNAME: '0.0.0.0' }),
    'etc/migrate.env': envFile({ MIGRATOR_DATABASE_URL: db('app_migrator', role('app_migrator')) }),
    'etc/roles-anywhere.env':
      '# The trust anchor, profile and role ARNs are in /opt/archova/.env.\n',
    'etc/db-ca.pem': s.database_ca.endsWith('\n') ? s.database_ca : `${s.database_ca}\n`,
    'etc/Corefile': renderCorefile(input.allowlist, [s.database_host]),
  };
  if (primary) {
    out['etc/valkey.env'] = envFile({ VALKEY_PASSWORD: s.valkey_password });
    // Same database and queue settings as the AWS tasks (infra/cells/cell/worker.tf, ai-worker.tf): the relay alone gets
    // the cross-tenant app_platform role; the ai-worker never does.
    const redisUrl = `redis://:${encodeURIComponent(s.valkey_password)}@${s.valkey_host}:6379`;
    out['etc/worker.env'] = envFile({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DATABASE_URL: db('app_rw', role('app_rw')),
      DATABASE_PLATFORM_URL: db('app_platform', role('app_platform')),
      REDIS_URL: redisUrl,
    });
    out['etc/ai-worker.env'] = envFile({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      WORKER_ROLE: 'ai',
      DATABASE_URL: db('app_rw', role('app_rw')),
      REDIS_URL: redisUrl,
      API_AI_PROVIDER: 'bedrock',
      API_AI_REGION: 'ap-southeast-2',
      API_AI_MODEL_FAST: models.fast,
      API_AI_MODEL_STANDARD: models.standard,
      API_AI_MODEL_ADVANCED: models.advanced,
    });
    // tools/db/roles.ts, as on AWS's db-roles task: the admin user creates or updates the app's roles.
    out['etc/db-roles.env'] = envFile({
      DB_HOST: s.database_host,
      DB_PORT: s.database_port,
      DB_NAME: s.database_name,
      DB_MASTER_SECRET: JSON.stringify({
        username: s.database_admin_user,
        password: s.database_admin_pass,
      }),
      ...Object.fromEntries(
        Object.entries(s.database_roles).map(([name, password]) => [
          `DB_ROLE_${name.toUpperCase()}`,
          JSON.stringify({ username: name, password }),
        ]),
      ),
    });
    out['etc/backup.env'] = envFile({
      PGHOST: s.database_host,
      PGPORT: s.database_port,
      PGUSER: s.database_admin_user,
      PGPASSWORD: s.database_admin_pass,
      PGDATABASE: s.database_name,
      AGE_RECIPIENT: o.deploy.value.backup_age_recipient,
      FILES_ENDPOINT: files.endpoint,
      FILES_BUCKET: files.name,
      FILES_KEY_ID: s.backup_key_id,
      FILES_KEY_SECRET: s.backup_key_secret,
      BACKUP_ENDPOINT: backups.endpoint,
      BACKUP_BUCKET: backups.name,
      BACKUP_KEY_ID: s.backup_key_id,
      BACKUP_KEY_SECRET: s.backup_key_secret,
      BACKUP_ALERT_URL: input.backupAlertUrl,
    });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outputsFile, index, imageTag, outDir] = process.argv.slice(2);
  if (!outputsFile || !index || !imageTag || !outDir)
    throw new Error('Usage: linode-host-files <outputs.json> <server index> <image tag> <out dir>');
  const jwk = process.env.LINODE_JWT_PRIVATE_JWK;
  if (!jwk) throw new Error('LINODE_JWT_PRIVATE_JWK is not set');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const files = renderHostFiles({
    outputs: JSON.parse(readFileSync(outputsFile, 'utf8')) as LinodeOutputs,
    allowlist: parse(
      readFileSync(join(root, 'infra/envs/linode-pilot/egress-allowlist.yaml'), 'utf8'),
    ) as Allowlist,
    server: Number(index),
    imageTag,
    jwtPrivateJwk: jwk,
    ...(process.env.BACKUP_ALERT_URL ? { backupAlertUrl: process.env.BACKUP_ALERT_URL } : {}),
  });
  for (const [path, content] of Object.entries(files)) {
    const file = join(outDir, path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, content, { mode: 0o600 });
  }
  console.log(`Wrote ${Object.keys(files).length} files for server ${index} to ${outDir}`);
}
