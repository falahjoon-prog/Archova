# Offline soak testing

Two layers. The automated one runs on every PR; the on-device one is run by hand before each pilot build.

## Automated (`packages/sync-core/test/soak.test.ts`)

Fake clock, fake server, real engine and outbox. Covers: 5 days offline with about 3,000 queued writes (defects, photos
that depend on them, edits), daily app restarts, backoff capped while offline, reconnect with lost responses (server
applied, reply never arrived), ordering of dependent writes, exactly-once application, and web edits made while the
phone was offline (must end as "Needs attention", never a silent overwrite). The existing `convergence.test.ts` covers
random two-device interleavings.

## On device (Android first, then iOS)

Run on a mid-range phone with the preview build, signed in to the demo organisation, projects kept offline.

1. Airplane mode on. Over 3 days of normal use: 20 defects with photos, 5 diary entries, 2 edits to a defect that
   someone also edits on the web. Kill the app twice, reboot the phone once, let the battery saver kick in.
2. Check: nothing missing from the lists, every item shows as waiting to sync, no crash, storage and battery sane.
3. Airplane mode off on weak mobile data. Check: it drains by itself, photos upload after their defect, the web
   shows every item once, the edited defect shows under Needs attention with both versions.
4. Repeat step 3 but toggle airplane mode on and off during the upload. No duplicates on the web.
5. Day 8 offline (change the phone clock or wait): the 7-day offline limit forces a sign-in, and the queued work is
   still sent afterwards.

Record phone model, OS, build number, queue size, time to drain and any defects found.
