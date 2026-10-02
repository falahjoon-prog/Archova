# @archova/mod-ai (Nova)

The `ai` module is the only door to AI models (X26). Design: [docs/ai/](../../docs/ai/) (Ari) and [ai-integration.md](../../docs/architecture/ai-integration.md) (Ava).

## Using Nova from a feature

Define the task's prompt in `@archova/ai-prompts` (`definePrompt`: id, version, feature, kind, tier, system prompt, input and output zod schemas, `render`, and `citations` if it cites), give it a credit price in `src/domain/credits.ts`, then call the gateway:

```ts
const run = await ai.runTask(ctx, myPrompt, input, { projectId, passages });
if (run.status === 'refused') {
  /* show "Nova couldn't answer this one" */
}
```

The gateway checks that Nova is on for the org, feature and caller, checks the monthly credit allowance (interactive work only), rate-limits per user, renders the prompt, routes the tier to a model, retries once and falls back a tier for interactive work, validates the output against the schema, drops citations that don't match a supplied passage, and logs every call in `ai.ai_requests` with credits and cost in `ai.ai_usage_ledger`. Output that changes a record goes into `ai.ai_suggestions`; the owning module applies it when a person accepts.

## Ask Nova retrieval (F2)

`POST …/ai/index` brings a project's index up to date: every published document and drawing revision (from `documents.api.aiSources`) is read page by page, chunked (`src/domain/retrieval.ts`), embedded through the gateway (`embed`, 0 credits) and stored in `ai.ai_chunks` with its access scope (`drawings` or `folder:<id>`). Re-runs skip finished revisions, mark older revisions superseded, re-stamp moved documents and drop deleted ones. The ai-worker will run this on `documents.*` events once it exists.

`POST …/ai/ask` gets the caller's scopes from `documents.api.aiAccessScopes`. `qa.rewrite` (Fast tier) turns the question into up to 3 searches with shorthand spelled out, plus the document, sheet and clause references it names. Each search runs keyword (Postgres full-text) and vector (pgvector, exact) queries filtered to those scopes inside the query; everything is merged by reciprocal rank fusion. `qa.rerank` (Fast tier) scores the top 30, and the best 10 relevant passages go to `qa.answer`. Rewrite and re-rank are free and optional: if either fails, retrieval carries on without it. An answer without a valid citation becomes "not found" with the closest matches. Postgres needs the `vector` extension (`pgvector/pgvector:pg16` locally and in CI; RDS ships it).

## Scanned pages (OCR)

A PDF page with no text layer is treated as a scan: `src/infra/pdf.ts` finds the image covering most of the page, `src/infra/raster.ts` turns it into a greyscale PNG (at most 5,000 px a side and under Textract's 10 MB limit, in plain TypeScript with no native canvas), and the gateway's `ocr` sends it to Textract `DetectDocumentText` in the provider's Australian region. OCR is background work: 0 credits, never stopped by the allowance, logged per page in `ai_requests` (tier `ocr`). Ask Nova indexing uses the OCR text like a text layer; the drawing register maps OCR lines back to page positions, picks the title block region and checks every field against it, and marks those suggestions `scanned: true`. Lines under 40% confidence are dropped. Pipeline version 2 re-indexes every revision once, so scans indexed before OCR existed are picked up.

## Diary summaries (F4)

`api.summariseDiaryDay(ctx, projectId, day)` takes one day from `diary.api.dayForSummary` (only the lines the caller may see) and drafts a short daily report with `diary.summary` (Standard tier, 0.5 credit, feature `diary_summary`). `src/domain/diary-summary.ts` numbers the lines as facts (`l1`, `l2` ...), adds the weather (`w`) and labour totals computed in code (`t`), and checks the output: a sentence that cites no supplied fact, or states a number its facts don't contain, is dropped; delay and stand-down lines no sentence mentions are listed in `unmentionedDelays`; "possible delay" is always raised when the day has a delay or stand-down line, with the cause the site recorded. The draft is a pending `ai_suggestions` row (target `diary_entry`) that whoever can write the diary accepts or rejects; it is reused until the entry's version changes. The route is added when `diary.api.dayForSummary` is on main.

## RFI drafts (F3)

`api.draftRfi` (route `POST …/ai/rfi-drafts`, needs `rfis.rfis.create`) turns a note typed on site into an RFI subject and question with prompt `rfi.draft` (Standard, 1 credit). The note is embedded and searched once under the caller's access scopes; the draft cites the passages it relies on, and the gateway drops citations that don't match. Numbers in the draft found in neither the note nor a cited passage (title included) come back in `unsupportedNumbers` for the form to highlight. Similar RFIs come from `rfis.api.findSimilar` (full-text, only RFIs the caller can see, no drafts or voided ones), and suggested assignees are whoever was asked those, most often first. Nothing is saved: the draft fills the RFI form and the person sends it. Typed notes only for now; markups and photos come later.

## Induction drafts (F33)

`POST …/ai/induction-drafts` searches the caller's visible documents once per required induction section (compliance/04 §2), then `induction.draft` writes slides, a script and a quiz. `src/domain/induction.ts` checks the draft before it is stored: items whose citation doesn't quote a passage, whose numbers aren't in their source, or that use a banned word are removed and listed in `warnings`; empty sections become `missing`; critical quiz flags are forced. The declaration and fixed safety sentences come from `INDUCTION_FIXED_TEXT`, not the model. The draft is a pending `ai_suggestions` row; `workforce` creates the induction version when the builder accepts (docs/ai/12).

## Induction Q&A (I3)

`api.indexInductionVersion` chunks a published induction version's slides and script (one page per slide) into `ai_chunks` with `source_type = induction` and scope `induction:<version id>`. `api.askInduction` searches that scope only and runs `induction.ask` (0.25 credit, feature `inductions`). An answer without a valid citation, or a question with nothing retrieved, returns `INDUCTION_ASK_SUPERVISOR` ("ask your supervisor or the site office"). Ask Nova never retrieves induction chunks, because `documents` never grants an `induction:` scope, and the project indexer only reconciles `document` and `drawing` chunks. These are module API calls with no route: `workforce` calls them on publish, and from the worker's route after the X45 access-link check.

## Induction translation (I4)

`api.translateInduction(ctx, version, language)` translates an approved induction version slide by slide and question by question (`translation.translate`, Standard tier, 0.25 credit per unit). Numbers, phone numbers, times, units, codes and kept terms (`src/domain/translation.ts`) go to the model as placeholders and are put back by code; a dropped or extra placeholder fails the unit. `translation.check` (Fast tier, free) back-translates each unit and judges whether the meaning held. A unit that fails stays in English with the language's fixed "ask your supervisor" note. Results are cached in `ai_translations` per version, source hash, language, glossary version and prompt version, with a `translationHash` for the completion record. Only languages in `TRANSLATION_LANGUAGES` with `enabled` and reviewed `labels` are offered (`api.translationLanguages`), and none is enabled until its glossary and labels are reviewed and its eval passes against Bedrock AU (compliance/03 §6).

## Providers

| `API_AI_PROVIDER` | Use                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fake` (default)  | Tests and local development. No network or credentials; tests script replies per task.                                                                                                                                                                                                                                                                                                                                |
| `bedrock`         | Deployed environments. Needs `API_AI_REGION` in Australia, `API_AI_MODEL_FAST/STANDARD/ADVANCED` and `API_AI_MODEL_EMBEDDING` (default Titan Text Embeddings V2). Only in-region model ids or `au.` inference profiles are accepted (X25); `apac.`, `us.`, `global.` and the rest are refused. OCR uses Textract in the same region (`textract:DetectDocumentText`; `API_AI_TEXTRACT_ENDPOINT` for its VPC endpoint). |

Vendor SDKs may be imported only in `src/infra/providers/` (`pnpm check:boundaries`).

## Evals

```sh
pnpm --filter @archova/mod-ai eval                                 # every suite, fake provider (CI)
pnpm --filter @archova/mod-ai eval --task qa.answer --provider bedrock --sample 50 --out report.md
```

Each suite (`src/eval/suites.ts`) is a task's prompt, its golden set (synthetic or public documents only until a pilot gives written consent), a scorer and the acceptance bars from docs/ai/01 §4. The run exits 1 when any metric is below its bar; safety metrics (tenant canaries, restricted sources) have a bar of 100%. The fake provider runs the prompt, schema, citation check and scorers on every change; real scores need `--provider bedrock` with `AI_EVAL_MODEL_*` set.
