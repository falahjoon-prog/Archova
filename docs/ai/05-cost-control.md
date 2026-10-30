# AI cost control at 100,000+ users

**Owner:** Ari · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
**Related:** licensing and plans are Sam's area ([docs/security-licensing/](../security-licensing/), architecture D11); infrastructure cost dashboards are Owen's ([docs/infrastructure/](../infrastructure/), see [07-cost-estimates.md](../infrastructure/07-cost-estimates.md)).

## 1. Cost model

All figures are model and AI-service spend only, in **US dollars**, using Anthropic first-party per-token prices (Haiku 4.5 $1/$5, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per million input/output tokens; cache reads $0.10–0.20). Bedrock AU prices must be confirmed and this table re-run ([02-models-and-providers.md](02-models-and-providers.md) §3). A$ figures use ~1.5 A$ per US$. The calculation is reproducible from the assumptions below; it already includes prompt caching on stable prefixes and batch pricing for background work.

### Assumptions

- 100,000 registered users across ~10,000 orgs and ~100,000 active projects (from Ava's sizing).
- **Base case:** 50% of users use an AI feature in a month.
- Per AI-active user per month: 40 project questions (F2), 4 RFI drafts (F3), 10 diary summaries (F4), 15 defect photo tags (F5), 2 meeting minutes (F7), 20 small fast-tier tasks (search rewrites, classifications), 1 advanced-tier task (submittal or claim check, later phases).

### Cost per use

| Task | Model | Typical tokens (in / out) | Cost per use |
|---|---|---|---|
| Ask the project (incl. rewrite + re-rank) | Sonnet 5.5 + Haiku 4.5 | ~24k / ~1.5k | $0.041 |
| RFI draft (incl. retrieval) | Sonnet 5.5 + Haiku 4.5 | ~27k / ~2k | $0.050 |
| Diary summary | Sonnet 5.5 | ~6.5k / ~0.8k | $0.018 |
| Defect photo tag | Haiku 4.5 (vision) | ~4k / ~0.3k | $0.004 |
| Meeting minutes | Sonnet 5.5 | ~21k / ~2k | $0.057 |
| Small fast task | Haiku 4.5 | ~3k / ~0.3k | $0.004 |
| Advanced check | Opus 5.5 | ~35k / ~3k | $0.181 |

That is about **$2.45 per AI-active user per month**, of which Ask the project is two thirds. It is the line to watch.

### Background work per month (base case)

| Work | Volume | Cost |
|---|---|---|
| Title block extraction (F1), batch | ~6M drawing sheets | ~$7.8k |
| Daily risk digest (F8), only on project-days with signals, batch | ~0.66M | ~$6.7k |
| Weekly summaries (F4), batch | ~0.43M | ~$5.7k |
| Embeddings | ~50B tokens | ~$1k (model-dependent) |
| OCR of scanned pages (Textract) | ~5M pages | ~$7.5k |
| **Total** | | **~$29k** |

### Scenarios at 100,000 users

| Scenario | AI-active users | Usage vs base | Monthly total | Per registered user |
|---|---|---|---|---|
| Light | 30% | half | ~$57k | ~$0.57 (A$0.85) |
| **Base** | 50% | as above | **~$151k** | **~$1.51 (A$2.27)** |
| Heavy | 70% | 1.5× | ~$294k | ~$2.94 (A$4.42) |

**Target:** bring the base case to **≤ $1.00 per registered user per month** (~$100k total) using the levers in §3, without dropping below each feature's quality bar. Revisit with real pilot usage at the end of phase 1; these usage numbers are estimates, not measurements.

### After the Ask-the-project levers (source of truth for AI cost, confirmed by Ava 2 Oct 2026)

The table above is *before* the Ask-the-project levers (L3, L5, L6). Applying them (re-rank to ~8 passages so input falls to ~7.5k tokens, 20% of questions answered from the per-org result cache, half of the rest answered by Haiku 4.5) brings Ask the project from $0.041 to ~$0.016 per question and the AI-active user from ~$2.45 to ~$1.39 a month.

| Scenario | Before levers | After levers (target) |
|---|---|---|
| Light | ~$57k | ~$41k |
| **Base** | **~$151k** | **~$100k (≈ A$155k), US$1.00 per user** |
| Heavy | ~$294k | ~$185k |

**Budget US$151k a month at 100,000 users until the levers are proven on the eval; the target is US$100k or less.** Owen's [07-cost-estimates.md](../infrastructure/07-cost-estimates.md) §5 references this section. His earlier $15–40k assumed ~3k input tokens per request on a small model and about half our request volume. Answering questions over project documents needs the retrieved passages in the prompt (~7–12k tokens even after trimming), so ~$40k is our light case, not the expected one. Tagging every site photo (rather than only defect photos) would add ~$25k a month and is not included.

## 2. Principles

1. **Measure cost per completed task**, not per call. A cheap call that needs a retry, or a draft the user rewrites, isn't cheap.
2. **Free wins before trade-offs:** caching, trimming what we send, batching and precomputing first; cheaper models or lower effort only where the eval shows quality holds.
3. **Every call is metered and attributed** to org, user, feature and prompt version (03 §5). No unattributed spend.
4. **Every org has a budget**, so one tenant can never run up an unbounded bill.

## 3. Levers, in the order we apply them

| # | Lever | How | Expected effect |
|---|---|---|---|
| L1 | **Precompute at upload** | Title blocks, drawing descriptions, photo tags, chunk summaries are made once in the background, then reused by every question | Fewer and smaller interactive calls |
| L2 | **Prompt caching** | Stable instructions, schemas and examples first, marked cacheable; volatile content last. Per-org style block after the shared prefix. Track `cache_read` tokens per task and alert on drops | Cached input costs ~10% of normal input |
| L3 | **Send less** | Re-rank to the best 8–12 passages, not 50; strip boilerplate (title block text, legends) from chunks; cap answer length per task with `max_tokens` | Q&A input could fall from ~24k to ~12k tokens |
| L4 | **Batch everything not interactive** | Title blocks, digests, weekly summaries, re-embedding go through batch inference | ~50% off that work |
| L5 | **Result cache per org** | Same question over the same document set (by revision hash) within a window returns the stored answer, with sources | Common for repeated questions on a project |
| L6 | **Route by difficulty** | Simple look-ups ("what's the current rev of A-201?") are answered from structured data or by Haiku; Sonnet only for synthesis | Large share of Q&A moves to the fast tier |
| L7 | **Tune effort** | Run each Sonnet/Opus task at the lowest effort that passes its eval; re-check after model releases | Fewer thinking and output tokens |
| L8 | **Rules before AI** | Risk alerts (F8) are found by SQL rules; AI only explains the ones found; no AI call on quiet days | Avoids calls with nothing to say |
| L9 | **Budgets and limits** | Per-org monthly credit cap, per-user rate limit, per-feature daily ceilings, global token governor per model | Hard ceiling on spend |
| L10 | **Revisit specialised models** | If a narrow task (photo tagging, title blocks) becomes a top cost line, test a smaller dedicated model; switch only if it wins on the eval at lower total cost including operations | Phase 3+ option |

L3 + L5 + L6 alone on Ask the project are expected to roughly halve its cost, which gets the base case near the $1.00 target. Each lever ships behind a flag and is measured against the eval before it stays on.

## 4. Budgets, quotas and degradation

- **Org monthly credit allowance** from the plan (see §5). At 80% the org admin is notified; at 100% interactive features either stop or continue on paid top-up, per the org's setting. Background work that keeps the product correct (title blocks, embeddings) is never stopped by credits; it is covered by the plan.
- **Daily cap on document embeddings** (built): background embedding costs no credits, so a loop or bulk re-index is held by tokens per org per local day instead (`API_AI_EMBED_DAILY_TOKENS`, default 25M tokens, about US$0.50 at list price). Past it, indexing waits for the next local day (`ai.embedding_limit`, 429 with `resetsAt`); questions and induction Q&A are not held back. OCR and title blocks have no such cap yet.
- **Per-user limits** (e.g. 30 AI requests per 10 minutes) stop scripts or loops, not normal use.
- **Global protection:** if spend for a day passes 150% of forecast, alert Ari and Owen; at 200%, lower-priority batch work pauses automatically.
- **Degrade, don't fail:** under provider rate limits, interactive Q&A falls back to the fast tier with a "shorter answer" note, and background work waits.

## 5. AI credits and licensing (proposal for Sam)

Pricing is per company, not per seat (plan §1), so AI needs its own meter that doesn't punish subcontractors joining for free.

- **AI credit** = a fixed unit of AI work. Proposed: 1 credit ≈ one Ask the project question; other tasks cost a fixed number of credits based on their average cost (e.g. defect tag 0.1, RFI draft 1, minutes 1.5, advanced check 5). Fixed credit prices per task keep it predictable for customers; we absorb variance.
- **Each plan includes a monthly credit allowance per org**, sized from expected users on that plan (the base case is ~60 credits per AI-active user per month). Top-up packs available.
- **Credits are charged to the builder org that owns the project**, including when invited subcontractors use AI on that project, so subbies stay free. The owning org can limit AI for external companies.
- Enterprise plans: custom allowance, dedicated provider quota, and optional first-party Claude API routing.
- Credit consumption is recorded in `ai_usage_ledger` and exposed to Sam's billing module through the entitlement interface (architecture D11).

## 6. Reporting

- Daily: cost by feature, model, org (top 50), cache hit rate, batch share, fallback rate.
- Weekly: cost per completed task and acceptance rate per feature, trend against target.
- Per org (visible to their admin): credits used by feature and by user, remaining allowance.
- Owen's infrastructure dashboard shows AI spend next to compute and storage so the per-user unit cost of the whole platform is one number.
