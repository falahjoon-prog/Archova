# apps/admin: the Archova owner console

Staff-only console (ADR-0008): customers, plans and the price book, with a second-person approval for every price or plan change. It talks to `/internal/v1` on `apps/api` (the `backoffice` module), never to the customer API.

Run it on your own computer: `docs/infrastructure/admin-local.md`.
