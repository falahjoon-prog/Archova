import type { ConfigContext, ExpoConfig } from 'expo/config';

// API base URL (`https://api.<domain>` in production, bearer auth only; ADR-0004 §3) and the web app origin that
// hosts /v1/oauth/authorize and the sign-in page. EXPO_PUBLIC_* vars are also inlined into the bundle by Metro.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const appOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Archova',
  slug: 'archova',
  version: '0.0.0',
  scheme: 'com.archova.app',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  // New Architecture (Fabric, TurboModules) is always on from SDK 55; the old `newArchEnabled` flag no longer exists.
  ios: {
    bundleIdentifier: 'com.archova.app',
    supportsTablet: true,
  },
  android: {
    package: 'com.archova.app',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    // SQLCipher for the per-organisation device database (mobile 02 §2.3); lib/db refuses to open without it.
    ['expo-sqlite', { useSQLCipher: true }],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiUrl,
    appOrigin,
  },
});
