import type { ConfigContext, ExpoConfig } from 'expo/config';
import { brand } from '@archova/design-tokens';

// API base URL (`https://api.<domain>` in production, bearer auth only; ADR-0004 §3) and the web app origin that
// hosts /v1/oauth/authorize and the sign-in page. EXPO_PUBLIC_* vars are also inlined into the bundle by Metro.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const appOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';

const VERDIGRIS = brand.verdigris;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Archova',
  slug: 'archova',
  version: '0.0.0',
  scheme: 'com.archova.app',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  // Keystone mark on Verdigris (docs/mobile/06 §6.1, design 02 §2); files come from the brand pack.
  icon: './assets/icon.png',
  // New Architecture (Fabric, TurboModules) is always on from SDK 55; the old `newArchEnabled` flag no longer exists.
  ios: {
    bundleIdentifier: 'com.archova.app',
    supportsTablet: true,
  },
  android: {
    package: 'com.archova.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: VERDIGRIS,
    },
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { image: './assets/splash-mark.png', imageWidth: 160, backgroundColor: VERDIGRIS },
    ],
    'expo-secure-store',
    'expo-web-browser',
    'expo-video',
    // SQLCipher for the per-organisation device database (mobile 02 §2.3); lib/db refuses to open without it.
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-camera',
      {
        cameraPermission:
          'Archova uses the camera to take site photos for defects and the site diary.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Archova records where a site photo was taken so it can be placed on the project.',
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiUrl,
    appOrigin,
  },
});
