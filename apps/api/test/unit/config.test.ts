import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = { API_DATABASE_URL: 'postgres://app_rw:x@db:5432/archova' };

describe('config', () => {
  it('derives app hosts from origins', () => {
    const c = loadConfig({
      ...base,
      API_APP_ORIGINS: 'https://app.example.com',
      API_PUBLIC_HOSTS: 'api.example.com',
    });
    expect(c.appHosts).toEqual(['app.example.com']);
    expect(c.jwtIssuer).toBe('https://api.example.com');
  });

  it('refuses to start in production without keys, Redis, S3, a scanner and https origins', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /API_JWT_PRIVATE_JWK.*API_REDIS_URL.*API_FILES_STORE=s3.*API_FILES_SCANNER=guardduty.*https/,
    );
  });

  it('takes one webhook key or versioned pairs, and names the problem without echoing a key', () => {
    const k = (n: number) => Buffer.alloc(32, n).toString('base64');
    expect(loadConfig({ ...base, API_WEBHOOK_SECRET_KEY: k(1) }).webhookSecretKey).toBe(k(1));
    expect(
      loadConfig({ ...base, API_WEBHOOK_SECRET_KEY: `2:${k(1)},3:${k(2)}` }).webhookSecretKey,
    ).toContain('3:');
    expect(() => loadConfig({ ...base, API_WEBHOOK_SECRET_KEY: 'c2hvcnQ=' })).toThrow(
      /API_WEBHOOK_SECRET_KEY is not valid: each key must be 32 bytes/,
    );
  });

  it('needs S3 for the GuardDuty scanner, which reads object tags', () => {
    expect(() => loadConfig({ ...base, API_FILES_SCANNER: 'guardduty' })).toThrow(
      /API_FILES_STORE=s3/,
    );
    expect(
      loadConfig({ ...base, API_FILES_SCANNER: 'guardduty', API_FILES_STORE: 's3' }).files.scanner,
    ).toBe('guardduty');
    expect(() => loadConfig({ ...base, API_FILES_SCANNER: 'clamav' })).toThrow(
      /API_FILES_STORE=s3/,
    );
    expect(
      loadConfig({ ...base, API_FILES_SCANNER: 'clamav', API_FILES_STORE: 's3' }).files.clamav,
    ).toEqual({ host: 'clamav', port: 3310, timeoutMs: 30_000 });
  });

  it('takes storage keys for S3-compatible storage outside AWS, as a pair', () => {
    expect(loadConfig(base).files.credentials).toBeNull();
    expect(
      loadConfig({ ...base, API_S3_ACCESS_KEY_ID: 'AKID', API_S3_SECRET_ACCESS_KEY: 'secret' })
        .files.credentials,
    ).toEqual({ accessKeyId: 'AKID', secretAccessKey: 'secret' });
    expect(() => loadConfig({ ...base, API_S3_ACCESS_KEY_ID: 'AKID' })).toThrow(/both/);
  });

  it('refuses staff password sign-in and a short solo-owner delay in production unless it is a demo cell', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...prod, API_STAFF_LOCAL_LOGIN: 'true' })).toThrow(
      /API_STAFF_LOCAL_LOGIN/,
    );
    expect(() => loadConfig({ ...prod, API_STAFF_SOLO_COOLING_OFF_HOURS: '1' })).toThrow(
      /at least 24/,
    );
    // A demo cell passes the staff checks; the usual production requirements still apply after them.
    expect(() =>
      loadConfig({
        ...prod,
        API_STAFF_DEMO_CELL: 'true',
        API_STAFF_LOCAL_LOGIN: 'true',
        API_STAFF_SOLO_COOLING_OFF_HOURS: '1',
      }),
    ).toThrow(/API_JWT_PRIVATE_JWK/);
    const dev = loadConfig(base);
    expect(dev.internal.localLogin).toBe(true);
    expect(dev.internal.soloCoolingOffHours).toBe(24);
  });
});
