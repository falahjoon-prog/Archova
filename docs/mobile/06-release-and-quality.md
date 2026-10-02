# 6. Builds, app store release, testing and monitoring

## 6.1 Accounts and identity (do early: some take weeks)

- **Apple Developer Program, organisation account.** Needs a legal entity and a D-U-N-S number; verification can take one to three weeks.
- **Google Play Console, organisation account.** Needs a D-U-N-S number and identity verification. New personal accounts must run a closed test before production, so an organisation account is strongly preferred.
- App name **Archova** (decision X24). iOS bundle ID and Android application ID: **`com.archova.app`** for production. Development and preview builds use `com.archova.app.dev` and `com.archova.app.preview` so all three can sit on one phone. Store IDs cannot be changed after release, so register `com.archova.app` in both consoles before the first TestFlight build.
- Universal links / App Links: host `apple-app-site-association` and `assetlinks.json` on our web domain.
- APNs auth key (.p8) and Firebase project for FCM, stored in the secrets manager, never in the repo.

## 6.2 Build pipeline

- **EAS Build** produces signed iOS and Android binaries in the cloud; signing credentials are managed by EAS.
- Three build profiles:

| Profile | Audience | Backend | Distribution |
|---|---|---|---|
| development | Engineers | Local or dev | Dev client |
| preview | Team and pilot builders | Staging (AWS Sydney, see `docs/infrastructure/02-environments.md`) | TestFlight, Play internal testing |
| production | Customers | Production | App Store, Google Play |

- CI (pipeline owned by Owen) on every pull request that touches `apps/mobile` or a package it uses: typecheck, lint, unit tests, `@archova/sync-core` property tests, and a preview build when `apps/mobile` or shared packages change.
- Version: semantic version for users (`1.4.0`), auto-incremented build numbers.

## 6.3 Release process

1. Release branch cut every two weeks.
2. Preview build to internal testers and pilot builders; Maestro end-to-end suite runs on real devices.
3. **EAS Submit** uploads to App Store Connect and Play Console.
4. Staged rollout: Google Play 5% → 20% → 50% → 100% over about a week; Apple phased release over 7 days. Halt if crash-free sessions drop below 99.5%.
5. Release notes written in plain language for site users.

### Store review readiness
- Demo account with a sample project for Apple and Google reviewers, noted in review notes.
- Privacy labels (Apple) and Data safety form (Google): camera, photos, location (only while using), contacts not collected, no tracking, no ads.
- Permission prompts explained in context ("Location is used to tag site photos"), with purpose strings in `app.json`.
- Account deletion available inside the app (both stores require it).
- Sign in with Apple is not required because we use company SSO and email sign-in, not third-party social logins; confirm if social login is ever added.
- In-app purchases: licences are sold to companies outside the app, so the app has no purchase flow and does not mention pricing. This is the normal B2B arrangement and keeps us out of Apple's in-app purchase rules.

## 6.4 Over-the-air updates

- **EAS Update** ships JavaScript-only fixes without a store review, on channels matching the build profiles.
- `runtimeVersion` follows the native fingerprint, so an OTA update only reaches binaries it is compatible with.
- Updates download in the background and apply on next launch; critical fixes can force a reload at a safe point (never during an upload or with unsaved input).
- OTA is for fixes and small changes, not new features that would need review (to stay within store rules).
- Rollback: republish the previous update to the channel.

## 6.5 Forced upgrade

- The server reports minimum supported app and sync protocol versions.
- Below minimum: a full-screen "Update required" screen, but unsynced data stays on the device and is uploaded after the update.

## 6.6 Enterprise distribution

- Larger builders may manage phones with MDM (Microsoft Intune, Jamf). Support **managed app configuration** (pre-set server URL, SSO domain, enforced app lock) through the AppConfig standard.
- Both public stores support MDM installs; no separate enterprise build is needed.

## 6.7 Testing

| Level | Tooling | Scope |
|---|---|---|
| Unit | Jest | Sync engine, command definitions, markup geometry |
| Component | React Native Testing Library | Screens with a seeded local database |
| End to end | Maestro | Sign-in, create defect offline, sync, close-out with photos, drawing markup, push deep link |
| Device lab | Real devices (and a cloud device farm) | Small iPhone, current iPhone, iPad, low-end Android, rugged Android, Android tablet |
| Field trial | Pilot builders | One week on a live site before each major release |

Offline scenarios are mandatory in every release test: no network all day, flaky network, app killed mid-upload, low storage, clock changed.

## 6.8 Monitoring

- Crash and error reporting with Sentry (source maps uploaded by EAS), with personal data scrubbed.
- Product analytics events (screen views, feature use, sync durations, outbox size) sent to the platform's analytics pipeline; no third-party ad SDKs.
- Key mobile health metrics on the team dashboard: crash-free sessions (target 99.7%), median sync time, outbox items older than 24 hours, upload failure rate, cold start time (target under 2 seconds on a mid-range Android).

## 6.9 Team

Phase 3 launch needs about two mobile engineers plus shared help from backend (sync endpoints, change feed, push worker) and the UI specialist (mobile design system). Phase 1 capture build can be done by one mobile engineer.
