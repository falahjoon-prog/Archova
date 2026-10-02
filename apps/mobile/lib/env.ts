import Constants from 'expo-constants';
import { resolveConfig } from './config';

// Metro inlines `process.env.EXPO_PUBLIC_*` only for direct property access, so read each var explicitly.
export const appConfig = resolveConfig(Constants.expoConfig?.extra, {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_APP_ORIGIN: process.env.EXPO_PUBLIC_APP_ORIGIN,
});
