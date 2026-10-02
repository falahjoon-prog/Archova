# 1. Framework choice and app structure

## 1.1 Framework: Expo (React Native)

**Decision:** build one app for iOS and Android with Expo SDK (React Native New Architecture: Fabric renderer, TurboModules, Hermes engine), written in TypeScript.

### Options considered

| Option | For | Against | Verdict |
|---|---|---|---|
| **Expo / React Native** | TypeScript like the rest of the stack; shares domain code, schemas and API client with Next.js; one team can work on web and mobile; EAS handles builds, signing and OTA updates; native modules available when needed | Heavy custom rendering (drawings) needs care; some native work still required | **Chosen** |
| Flutter | Excellent rendering performance, single codebase | Dart means nothing shared with the web app; second language and toolchain to hire for | Rejected |
| Native Swift + Kotlin | Best platform fit and performance | Two codebases, two teams, double the cost for every field feature; nothing shared with web | Rejected for now; individual native modules are fine |
| PWA (web app on phone) | Zero store friction | iOS limits on background sync, storage eviction, weak camera and file access, unreliable push; not good enough for days offline on site | Rejected for the field app; the web app should still be usable on a phone browser |

### Where we go native

Expo's "continuous native generation" lets us add native code through config plugins without ejecting. Expected native pieces:

- Background file upload (iOS `URLSession` background sessions, Android `WorkManager`).
- Camera capture with high frame-rate preview (`react-native-vision-camera`).
- Drawing and markup rendering with `@shopify/react-native-skia` (GPU canvas).
- On-device database: `expo-sqlite` (or `op-sqlite` if benchmarks demand it) with Drizzle ORM.

### Minimum platform versions

- iOS 16 and later (covers more than 95% of active iPhones and iPads).
- Android 9 (API 28) and later, tested on low-end and rugged devices common on site (Samsung XCover, Galaxy A series, CAT and Oukitel rugged phones).
- Phones and tablets on both platforms; tablet gets a split view (list beside detail, drawing beside defect).

## 1.2 App structure

### Navigation (expo-router, file-based)

Tabs follow Uma's mobile navigation ([design 03 §5](../design/03-navigation-ia.md)): Home, Drawings, Capture (centre), Tools, Me. The project switcher sits in the header and remembers the last project.

```
app/
  (auth)/              sign-in, SSO callback, organisation picker
  (tabs)/
    home               my items today across projects, sync status, quick add
    drawings           offline drawing set for the current project
    capture            one tap to start: photo, defect, diary note, observation, incident
    tools              every project tool the user can access
    me                 notifications inbox, profile, settings, site mode, offline storage
  project/[projectId]/
    drawings/          register -> sheet viewer -> markup
    defects/           list, map on drawing, detail, close-out
    diary/[date]       weather, labour, plant, deliveries, delays, visitors, notes, photos
    rfis/              list, detail, respond, raise
    photos/            albums by date and location
    inspections/       (phase 2) run checklists
    observations/      (phase 2)
    incidents/         (phase 2)
    documents/         browse, preview, keep offline
```

Tablets (768 px and wider) switch to a left rail with list beside detail, as in the design doc.

Every route reads from the local database through hooks, never directly from the network. Deep links (universal links and App Links on our web domain, so the same URL opens the app if installed and the web otherwise) map onto these same routes, so a link in an email or push opens the right screen on whichever device it is tapped.

### Source layout inside the app

Same feature-slice shape as web and backend ([architecture repo-structure §4](../architecture/repo-structure.md#4-mobile-app-structure-appsmobile)); feature folder names match backend module names one to one.

```
apps/mobile/
  app/                 Expo Router routes (thin: render a screen from features/, no logic)
  features/            one folder per module: defects, diary, drawings, rfis, photos ...
    defects/
      screens/         page-level compositions
      components/      module-specific components
      hooks/           useDefects, useDefect (queries over the local store)
      commands.ts      offline commands this module can queue
      index.ts         the only file other features may import
  shared/              app-wide providers, layout pieces
  lib/
    db/                SQLite schema and migrations (Drizzle), encryption key handling
    files/             upload queue, file cache, eviction
    platform/          push, camera, permissions, secure storage, background tasks
    telemetry/         Sentry, analytics
```

Rules:
- Features never import each other's internals, only their `index.ts`.
- Generic components come from `@archova/ui-native` (Uma and Mia), never rebuilt inside a feature.
- All server calls go through the generated `@archova/api-client` or the `@archova/sync-core` engine; no hand-written `fetch`.
- Server data lives in the local store; Zustand only for small UI state; TanStack Query only for online-only reads (search, AI Ask, reports).
- Business rules come from `@archova/domain`, the same code the backend modules run (state machines, validators, business-day dates). The app validates input with the zod schemas from `@archova/contracts` and hides actions with `can()` from `@archova/domain/permissions` over the permissions summary the API returns ([security 02](../security-licensing/02-roles-permissions.md)). Frontend apps never import `modules/*`, and the server re-checks everything.

## 1.3 Sign-in, security and licensing on the device

Sam owns the auth design ([security 01](../security-licensing/01-authentication-sso.md)); this is how the app applies it.

- **Sign-in:** OIDC authorisation code with PKCE in the system browser (`expo-auth-session`), so passkeys and enterprise SSO work without app changes.
- **Tokens:** bearer access JWT with a **10-minute** lifetime and no `org` claim (the org always comes from the URL path), held in memory; mobile calls `api.<domain>` with bearer auth only ([ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md)); opaque refresh token, rotated on every use, in the Keychain / Android Keystore (`expo-secure-store`). Handled by `@archova/auth-client`.
- **Realtime socket:** the app connects to `apps/realtime` and sends its access token in the **first message** after connecting (not in the URL). The server closes the socket when the token expires unless the app sends a refreshed one, and closes it within seconds if the session is revoked; the app then refreshes and reconnects with backoff.
- **App lock:** optional Face ID / fingerprint unlock, which an organisation can require. It is a local gate only, not a factor the server trusts.
- **Local data:** SQLite encrypted at rest (SQLCipher) with a key held in Keychain/Keystore. Photos and drawings sit in the app sandbox, excluded from iCloud and Google backups.
- **Offline limit:** the app keeps working offline for up to **7 days** without a token refresh (organisation can lower it, minimum 1 day). After that it keeps unsynced work safe but blocks new work until the user signs in again.
- **Several organisations:** a subcontractor may work for several builders. One signed-in user, an organisation switcher, and a separate database file per organisation, so removing access is a file delete.
- **Licensing:** the app reads the organisation's entitlements on sync and hides modules that are not licensed. The core tier (documents, drawings, photos, RFIs, defects, diary, mobile app) is always included ([security 04](../security-licensing/04-licensing-model.md)). If a queued command hits an unlicensed module the server answers `402 module_not_licensed`, and the item goes to "Needs attention" with an explanation rather than being lost. An organisation that is past due goes read-only after its grace period, never wiped.
- **Remote wipe:** when a session is revoked, the user leaves the organisation, or a device is reported lost, the next sync (or a silent push) deletes that organisation's local data and files.

## 1.4 AI features on mobile

AI runs in the platform `ai` module behind the AI gateway (architecture D10; Ari's docs in `docs/ai/`). The app captures input and shows results.

| Feature (Ari's ID) | On mobile | Offline |
|---|---|---|
| Voice to diary and defects (F14) | Dictation uses the phone's own speech-to-text, so raw audio stays on the device; the server turns the transcript into structured diary lines or defects for the user to review | Transcript works offline; structuring is queued with the record and the suggestion appears after sync |
| Photo tagging for defects | Suggests title, trade and responsible company from a site photo | Defect saved without suggestions; they arrive later as editable hints |
| RFI auto-draft (F3) | Draft an RFI from a photo, markup or a few typed words | Queued |
| AI Ask | Questions over drawings, specs and RFIs with cited sources | Online only, clearly labelled |

AI output is always shown with the shared "AI draft" label and accept / edit / reject controls agreed with Uma, Felix and Ari, never written silently into a record, because diary entries and defects can become contractual evidence.

## 1.5 Accessibility, language and field conditions

- Follows Uma's design principles and WCAG 2.2 AA target: touch targets at least 48 x 48, primary field actions in the bottom third of the screen, **site mode** high-contrast theme for direct sunlight, dark theme.
- Dynamic type and screen reader labels on every control (VoiceOver, TalkBack).
- English (Australia) first, with all strings in `packages/i18n` so other languages can be added.
- Dates, currency (AUD, GST) and number formatting come from `@archova/i18n`. Deadlines such as SOPA due dates use the business-day rules and holiday tables in `@archova/domain`, the same code the server runs, so phone and web never disagree; the server's stored value is authoritative.
- Sync state is always visible in words, not just an icon ("3 items waiting to sync"), and announced to screen readers.
