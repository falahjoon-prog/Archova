// Runtime configuration. Pure so it can be unit tested; `lib/env.ts` feeds it from expo-constants and process.env.

export interface AppConfig {
  /** `https://api.<domain>`: bearer-only API origin for mobile (ADR-0004 §3). */
  apiBaseUrl: string;
  /** `https://app.<domain>`: hosts /v1/oauth/authorize and the web sign-in page. */
  appOrigin: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: 'http://localhost:4000',
  appOrigin: 'http://localhost:3000',
};

const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().replace(/\/+$/, '') : undefined;

/** Precedence: EXPO_PUBLIC_* env (inlined at bundle time) > app.config `extra` > localhost defaults. */
export function resolveConfig(
  extra: Record<string, unknown> | null | undefined,
  env: { EXPO_PUBLIC_API_URL?: string | undefined; EXPO_PUBLIC_APP_ORIGIN?: string | undefined },
): AppConfig {
  return {
    apiBaseUrl: clean(env.EXPO_PUBLIC_API_URL) ?? clean(extra?.apiUrl) ?? DEFAULT_CONFIG.apiBaseUrl,
    appOrigin:
      clean(env.EXPO_PUBLIC_APP_ORIGIN) ?? clean(extra?.appOrigin) ?? DEFAULT_CONFIG.appOrigin,
  };
}
