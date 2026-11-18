# @archova/mobile

The Archova field app for iOS and Android: Expo SDK 57 (React Native 0.86, New Architecture, Hermes), expo-router.
Phase 0 skeleton: sign in, list your organisations and projects, open a project, sign out. Design docs: [`docs/mobile/`](../../docs/mobile/README.md).

## Run it

From the repo root (Node 22, pnpm 10):

```sh
pnpm install
pnpm --filter @archova/api dev        # API on http://localhost:4000
# web app on http://localhost:3000 hosts the sign-in page used by /v1/oauth/authorize
pnpm --filter @archova/mobile start   # Metro + Expo dev server
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with **Expo Go**. Every native module used
here (`expo-secure-store`, `expo-crypto`, `expo-web-browser`, `expo-router` and its peers) ships in Expo Go for SDK 57,
so a dev client is not needed yet. Once we add custom native code (vision-camera, Skia, background upload), use a
development build: `npx expo run:ios` / `npx expo run:android`, or `eas build --profile development`.

On a physical phone `localhost` is the phone itself: set the env vars below to your machine's LAN address
(e.g. `http://192.168.1.20:4000`). On the Android emulator use `http://10.0.2.2:4000`.

## Environment

| Variable                 | Default                 | What                                                                                      |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`    | `http://localhost:4000` | API origin, `https://api.<domain>` in production. Bearer auth only (ADR-0004 §3).         |
| `EXPO_PUBLIC_APP_ORIGIN` | `http://localhost:3000` | Web app origin, `https://app.<domain>`. Hosts `/v1/oauth/authorize` and the sign-in page. |

Both are read in `app.config.ts` into `extra` and also inlined by Metro as `process.env.EXPO_PUBLIC_*`; `lib/config.ts`
resolves env > `extra` > default. Put local overrides in `apps/mobile/.env.local` (git-ignored).

## Sign-in

OAuth 2.1 authorization code + PKCE in the system browser (ADR-0004 §2, mobile 01 §1.3), implemented in
`lib/auth/sign-in-flow.ts`:

1. `createPkce()` from `@archova/auth-client` with `expo-crypto` for random bytes and SHA-256; a random `state`.
2. `WebBrowser.openAuthSessionAsync(authorizeUrl(appOrigin, …), 'com.archova.app:/oauth/callback')`. Signed-out
   users are sent to the web sign-in page and come back to the authorize endpoint.
3. The redirect's `state` must match, then `session.exchangeCode(code, verifier)` posts to `${apiUrl}/v1/oauth/token`.
4. The 10-minute access token stays in memory; the rotating refresh token goes to the Keychain / Keystore through
   `lib/platform/secure-token-store.ts` (`expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).

Every API call goes through `createApiClient` with the mobile session middleware (bearer header, refresh once on 401).
A 401 that survives the refresh signs the user out.

## Structure

```
app/                     expo-router routes, thin: render a screen from features/
  _layout.tsx            providers + stack with signed-in / signed-out guards (Stack.Protected)
  (auth)/sign-in.tsx
  (tabs)/                Home, Drawings, Capture, Tools, Me (Drawings, Capture, Tools are placeholders)
  project/[projectId].tsx
  oauth/callback.tsx     fallback if the OS delivers the OAuth redirect as a deep link
features/                one folder per backend module; other code imports only a feature's index.ts
  auth/                  sign-in and Me screens (identity module)
  platform/              orgs and projects (platform module)
shared/                  app-wide providers (TanStack Query, session, current org) and small layout pieces
lib/
  api.ts                 the one session + API client + query options
  auth/sign-in-flow.ts   PKCE flow, pure and unit tested
  config.ts, env.ts      API / app origin resolution
  platform/              secure storage, crypto
test/                    vitest unit tests (Node, no device)
```

UI primitives come from [`@archova/ui-native`](../../packages/ui-native) (Button, TextField, Screen, ListItem), which
take every colour, size and spacing value from `nativeTheme()` in `@archova/design-tokens`. Lint rejects hex colour
literals in this app and in `ui-native`.

## Scripts

| Script                                |                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @archova/mobile start` | `expo start`                                                                           |
| `… ios` / `… android`                 | `expo start --ios` / `--android`                                                       |
| `… lint`                              | ESLint flat config (`frontend` from `@archova/config-eslint`)                          |
| `… typecheck`                         | `tsc --noEmit` (strict, extends `expo/tsconfig.base` + `@archova/config-ts/base.json`) |
| `… test`                              | vitest unit tests; no simulator needed                                                 |

Bundle check without a device: `npx expo export --platform ios --output-dir /tmp/expo-export` from `apps/mobile`.

## Monorepo notes and follow-ups

- **pnpm isolated installs work.** SDK 57 supports pnpm's default `node-linker=isolated`; `expo export` and
  `expo-doctor` pass without `node-linker=hoisted`. If a future native module's autolinking or a Gradle/CocoaPods
  step fails to find a transitive dependency, the known fallback is `node-linker=hoisted` in the root `.npmrc`. That
  is a repo-wide change and is deliberately not made here.
- `metro.config.js` watches the repo root and resolves from both `apps/mobile/node_modules` and the root
  `node_modules`. Package exports are on, so `@archova/*` packages that export TypeScript source
  (`"exports": { ".": "./src/index.ts" }`) are compiled by Metro/Babel directly; no build step.
- The root `.npmrc` has `auto-install-peers=true`. To stop pnpm from auto-installing newer, SDK-incompatible peers,
  `react-dom`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets` and
  `@react-native/metro-config` are pinned here to the SDK 57 versions from `expo/bundledNativeModules.json`.
- The New Architecture is always on from SDK 55; the old `newArchEnabled` app config flag no longer exists in the
  SDK 57 config schema, so it is not set.
- `expo-env.d.ts` is committed so `tsc` works in CI without running `expo start` first. Typed routes are off for the
  same reason; route strings come from `mobileRoutes` in `@archova/routes`.
- The orgs/projects screens use TanStack Query for online reads (phase 0). Field data moves to the local SQLite
  store via `@archova/sync-core` in later phases (mobile 02).
- Not done yet: app icon and splash assets, EAS config (`eas.json`), Sentry, i18n strings (`@archova/i18n`), the
  realtime socket, and universal links / App Links on the web domain.

## Testing on your own phone (Android APK)

The app needs SQLCipher and native speech modules, so it does **not** run in Expo Go. Use the `phone-test` EAS profile:

1. Make a free account at expo.dev, then on your PC: `npm i -g eas-cli && eas login`.
2. `eas.json` already points `phone-test` at the demo tunnel address (the dev web server proxies `/v1` to the API, so one
   address serves both). Quick tunnels change when restarted: if sign-in fails, update both values and rebuild. Otherwise set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_APP_ORIGIN` under `build.phone-test.env` to the public
   HTTPS addresses of the API and the web app (the web app hosts the sign-in page). Both must be reachable from the phone.
3. From `apps/mobile`: `eas init` (first time only), then `eas build --platform android --profile phone-test`.
4. Open the link EAS prints on the phone, download the APK and allow "install unknown apps". Sign in with the demo login.

The app id is `com.archova.app.preview`, so it installs beside any other build. iPhone builds need an Apple Developer
account and a registered device (`eas device:create`), then `--platform ios`.
