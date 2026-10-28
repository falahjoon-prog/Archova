import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import type { Allowlist } from './egress-allowlist';
import { type LinodeOutputs, renderHostFiles, storageRegion } from './linode-host-files';

const allowlist = parse(
  readFileSync(
    new URL('../../infra/envs/linode-pilot/egress-allowlist.yaml', import.meta.url),
    'utf8',
  ),
) as Allowlist;

// Synthetic values in the shape of `terraform output -json`.
const outputs: LinodeOutputs = {
  hosts: { value: { app: 'app.example.com.au', api: 'api.example.com.au' } },
  app_servers: {
    value: [
      { label: 'app-1', public: '192.0.2.10', vpc: '10.60.1.10' },
      { label: 'app-2', public: '192.0.2.11', vpc: '10.60.1.11' },
    ],
  },
  files_bucket: {
    value: { name: 'files', endpoint: 'https://ap-southeast-1.linodeobjects.com' },
  },
  backups_bucket: { value: { name: 'backups', endpoint: 'https://au-mel-1.linodeobjects.com' } },
  roles_anywhere: {
    value: { trust_anchor_arn: 'arn:ta', profile_arn: 'arn:profile', role_arn: 'arn:role' },
  },
  deploy: {
    value: {
      backup_age_recipient: 'age1example',
      ai_models: { fast: 'au.fast', standard: 'au.standard', advanced: 'au.advanced' },
    },
  },
  host_secrets: {
    value: {
      database_host: 'private-a1b2.db.example.net',
      database_port: 5432,
      database_admin_user: 'akmadmin',
      database_admin_pass: 'admin-pass',
      database_ca: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
      database_name: 'defaultdb',
      database_roles: {
        app_migrator: 'migrator-pass',
        app_rw: 'rw-pass',
        app_platform: 'platform-pass',
        app_admin: 'admin-role-pass',
      },
      valkey_password: 'valkey-pass',
      valkey_host: '10.60.1.10',
      files_key_id: 'FILESKEY',
      files_key_secret: 'files-secret',
      backup_key_id: 'BACKUPKEY',
      backup_key_secret: 'backup-secret',
    },
  },
};

const base = {
  outputs,
  allowlist,
  imageTag: '3f2c1ab',
  jwtPrivateJwk: '{"kty":"EC","crv":"P-256"}',
};

test('the primary gets every file, with the app wired to Linode storage, ClamAV and Bedrock in Sydney', () => {
  const f = renderHostFiles({ ...base, server: 0, backupAlertUrl: 'https://uptime.example/hb' });
  assert.deepEqual(Object.keys(f).sort(), [
    'etc/Corefile',
    'etc/api.env',
    'etc/backup.env',
    'etc/db-ca.pem',
    'etc/db-roles.env',
    'etc/migrate.env',
    'etc/roles-anywhere.env',
    'etc/valkey.env',
    'etc/web.env',
    'opt/.env',
  ]);
  assert.match(f['opt/.env']!, /^IMAGE_TAG='3f2c1ab'$/m);
  assert.match(f['opt/.env']!, /^VPC_IP='10.60.1.10'$/m);
  const api = f['etc/api.env']!;
  assert.match(
    api,
    /^API_DATABASE_URL='postgres:\/\/app_rw:rw-pass@private-a1b2\.db\.example\.net:5432\/defaultdb\?sslmode=verify-full'$/m,
  );
  assert.match(api, /^API_REDIS_URL='redis:\/\/:valkey-pass@10\.60\.1\.10:6379'$/m);
  assert.match(api, /^API_FILES_REGION='ap-southeast-1'$/m);
  assert.match(api, /^API_S3_ACCESS_KEY_ID='FILESKEY'$/m);
  assert.match(api, /^API_AI_REGION='ap-southeast-2'$/m);
  assert.match(api, /^API_JWT_PRIVATE_JWK='\{"kty":"EC","crv":"P-256"\}'$/m);
  assert.match(
    f['etc/db-roles.env']!,
    /^DB_ROLE_APP_RW='\{"username":"app_rw","password":"rw-pass"\}'$/m,
  );
  assert.match(f['etc/backup.env']!, /^FILES_KEY_ID='BACKUPKEY'$/m);
  assert.match(f['etc/backup.env']!, /^BACKUP_ALERT_URL='https:\/\/uptime\.example\/hb'$/m);
  assert.match(f['etc/Corefile']!, /^private-a1b2\.db\.example\.net:53 \{/m);
  assert.ok(f['etc/db-ca.pem']!.endsWith('-----\n'));
});

test('other servers get no admin, Valkey or backup credentials', () => {
  const f = renderHostFiles({ ...base, server: 1 });
  for (const k of ['etc/db-roles.env', 'etc/backup.env', 'etc/valkey.env'])
    assert.equal(f[k], undefined, k);
  assert.match(f['opt/.env']!, /^VPC_IP='10.60.1.11'$/m);
  assert.doesNotMatch(Object.values(f).join(''), /admin-pass|backup-secret/);
});

test('refuses a bad tag, server, key or value', () => {
  assert.throws(() => renderHostFiles({ ...base, server: 2 }), /No app server 2/);
  assert.throws(() => renderHostFiles({ ...base, server: 0, imageTag: 'x;rm -rf /' }), /image tag/);
  assert.throws(() => renderHostFiles({ ...base, server: 0, jwtPrivateJwk: 'not json' }));
  const quote = structuredClone(outputs);
  quote.host_secrets.value.files_key_secret = "it's";
  assert.throws(() => renderHostFiles({ ...base, outputs: quote, server: 0 }), /quote/);
});

test('storage region comes from the Object Storage endpoint', () => {
  assert.equal(storageRegion('https://au-mel-1.linodeobjects.com'), 'au-mel-1');
  assert.throws(() => storageRegion('https://s3.amazonaws.com'), /Linode/);
});
