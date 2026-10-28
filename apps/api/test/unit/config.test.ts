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
});
