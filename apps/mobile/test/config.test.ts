import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../lib/config';

describe('resolveConfig', () => {
  it('falls back to localhost defaults', () => {
    expect(resolveConfig(undefined, {})).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      apiBaseUrl: 'http://localhost:4000',
      appOrigin: 'http://localhost:3000',
    });
  });

  it('reads app.config extra', () => {
    expect(
      resolveConfig(
        { apiUrl: 'https://api.example.com', appOrigin: 'https://app.example.com' },
        {},
      ),
    ).toEqual({
      apiBaseUrl: 'https://api.example.com',
      appOrigin: 'https://app.example.com',
    });
  });

  it('prefers EXPO_PUBLIC_* env and strips trailing slashes', () => {
    expect(
      resolveConfig(
        { apiUrl: 'https://api.example.com', appOrigin: 'https://app.example.com' },
        { EXPO_PUBLIC_API_URL: 'https://api.staging.example.com/', EXPO_PUBLIC_APP_ORIGIN: ' ' },
      ),
    ).toEqual({
      apiBaseUrl: 'https://api.staging.example.com',
      appOrigin: 'https://app.example.com',
    });
  });
});
