# estimating

Phase 1 tender packages and quote comparison (product/10 EST-US1..6). Takeoff measurements follow in a separate PR.

- **Tables:** `tender_packages` (scope lines and linked documents as jsonb, allowances, award), `package_invites`, `quotes` (revision per company, EST-AC4), `quote_lines`. Money is decimal strings at the API and `numeric(18,2)`, with sums done in integer cents (`domain/tender.ts`).
- **Differences from schema/estimating.md:** quote status is `reading | ready_to_review | confirmed | superseded | declined` (what the web app needs; Nova extraction lands as `reading`), and allowances live on the package.
- **Access:** builder keys sit on the `commitments` tool (`packages.manage` and `quotes.review` need admin). `quotes.submit` is project membership; the service requires the caller's company to be invited, so a subcontractor only sees packages they were invited to (own invite only, no allowances or award) and their own quotes (EST-AC3).
- **Nova (F22):** `scopeForQuoteReading` (internal viewers only, package taking quotes) gives the `ai` module the trade and scope lines a PDF quote is read against. A quote saved from a Nova reading carries `aiSuggestionId` (builder staff only; stored in `quotes.ai_suggestion_id`, sets `source: ai_extracted`, and goes on `estimating.quote.received.v1`); the lines keep Nova's amount in `originalAmount` when the estimator corrects them.
- **Not yet:** invitation emails and access-link submission for non-users (X45), the comparison/outlier endpoint (the web computes it), CSV scope import, takeoff, sending takeoff quantities to scope lines.
