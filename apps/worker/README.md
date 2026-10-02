# apps/worker (not started)

Background job processors (BullMQ on Valkey, X19): outbox relay, event subscribers, the files pipeline (ClamAV scan, renditions, EXIF), PDF export, notifications. Loads the same modules as `apps/api`; no business logic of its own. Owner: Ben. Design: [docs/backend/05-background-jobs.md](../../docs/backend/05-background-jobs.md).

What phase 0 already provides for it:

- `shared.outbox` rows written in the same transaction as each change (`scope.events.add(...)` in `@archova/kernel`).
- `shared.change_feed` rows with a per-org sequence (`scope.recordChange(...)`).
- The upload completion logic in `@archova/mod-files` (`complete`), which the worker should run from the S3 event instead of the API.
