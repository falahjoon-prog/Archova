# Evaluation

**Owner:** Ari · **Status:** Draft v1 · **Last updated:** 2 Oct 2026

Evaluation is how we decide whether a feature ships, whether a prompt or model change is allowed, and whether a cost-saving lever stays on. No AI feature ships, and no prompt, model, retrieval or routing change merges, without passing its eval.

## 1. Three layers

| Layer | When | What it answers |
|---|---|---|
| **Offline evals** | Every change to a prompt, schema, model, routing or retrieval; nightly on main | Is this change at least as good as what's live, at what cost? |
| **Pilot review** | Before each feature goes from pilot to general release | Do real users at real builders find it correct and useful? |
| **Online monitoring** | Continuously in production | Is quality holding up across tenants, and is anything drifting? |

## 2. Golden sets

One per feature, stored in the repo next to the prompt (`packages/ai-prompts/<task>/eval/`), versioned, and never containing a real customer's data unless that customer has agreed in writing.

| Feature | Golden set (phase 1 target size) | Source |
|---|---|---|
| F1 Drawing register | 1,500 drawing sheets with correct title block fields, from at least 30 consultants' title block styles (architectural, structural, services, civil), including scans, rotated sheets and A1/A3 | Public tender sets plus consented pilot drawings |
| F2 Ask the project | 3 reference projects (specs, drawings, RFIs, diaries) with 400 questions: answerable (with the correct source), unanswerable, revision-sensitive ("as at rev B"), multi-document, permission-restricted | Built by us with a construction PM reviewer; consented pilot projects |
| F3 RFI draft | 200 scenarios (question, markup or photo) with an expert-written reference RFI and the correct references | Pilot RFIs (consented), expert-written |
| F4 Diary summary | 150 days of diary data with reference summaries and a list of every fact that must or must not appear | Synthetic diaries from real patterns, pilot data |
| F5 Defect tagging | 3,000 labelled defect photos across 25 trades | Consented pilot photos, our own site photography |
| F7 Minutes | 80 meeting transcripts with reference actions | Synthetic and consented |
| Safety suites | Tenant canaries, permission cases, prompt injections (§6) | Built by us |

Australian content matters: AS standards references, NCC terms, AU spelling, trade names and site shorthand ("subbie", "PC item", "EOT", "practical completion"). Sets are reviewed by someone with site experience before use.

## 3. Metrics and scorers

| Feature | Primary metrics | Scorer |
|---|---|---|
| F1 | Field-level exact match (number, revision, title, discipline, date); share of wrong fields flagged as low confidence | Deterministic comparison |
| F2 | Retrieval recall@10; answer correctness; citation precision (cited passage supports the claim); "not found" accuracy on unanswerable questions; zero restricted-source citations | Deterministic for retrieval and citations; LLM judge for correctness, calibrated against human labels |
| F3 | Reference correctness; required elements present (location, drawing, question, impact); expert preference vs reference | Rubric scored by an LLM judge + spot human review |
| F4 | Unsupported statements (hallucinations) per summary; required facts covered | LLM judge per statement against source entries |
| F5 | Trade top-1 / top-3 accuracy; defect type accuracy; assignee accuracy | Deterministic |
| All | Cost per task, latency p50/p95, schema-valid rate, refusal rate | From `ai_requests` |

**LLM judges.** Judges use Opus 5.5 (a stronger model than the one being judged, where possible) with a written rubric per feature. Before a judge is trusted, it is scored against ~100 human-labelled examples and must agree with humans at least 85% of the time; this is re-checked when the judge model or rubric changes. Judge prompts are versioned like any other prompt.

## 4. Release gates in CI

- A change to any task's prompt, schema, routing entry or retrieval config triggers that task's eval on a fixed sample (fast, cheap) in CI; the full set runs nightly.
- **Merge is blocked** if a primary metric drops by more than its tolerance (default 2 points, 0 for safety suites) versus main, or if cost per task rises more than 15% without a quality gain that's been signed off.
- The eval report (scores, cost, latency, diff of failures) is posted on the pull request.
- Eval spend is budgeted and tracked like production spend; samples are sized so a CI run costs a few dollars.

## 5. Pilot and online monitoring

- **Implicit signals:** suggestion accepted / edited / rejected; how much a draft was edited (edit distance) before sending; whether the user clicked a citation; re-asking the same question.
- **Explicit signals:** thumbs up/down with a reason (wrong, missing, not useful, wrong source) on every AI output.
- **Sampling review:** each week a reviewer reads a random sample (from orgs that allow review under our terms) of 50 outputs per P0 feature, scores them on the same rubric, and adds failures to the golden set.
- **Drift alerts:** acceptance rate or thumbs-down rate moving more than 10% week on week for a feature, or for a large org, opens an investigation.
- **A/B tests** behind feature flags for prompt or model changes that pass offline but need real-world confirmation; compared on acceptance rate and cost per accepted output.

## 6. Safety and isolation suites (run on every change, must be 100%)

- **Tenant canaries:** each test org contains unique canary phrases (e.g. a fake spec clause "CANARY-ORG-B-7731"). Queries from every other test org try hard to retrieve them. Any appearance in retrieval results or answers fails the build. The same canaries run continuously against staging, and a hidden canary org in production alerts on any hit.
- **Permission cases:** subcontractor, client and consultant users ask for commercial data, private folders and other companies' defects. Any restricted source in retrieval or citations fails.
- **Prompt injection:** documents, RFI responses, emails and photo text containing instructions (reveal other documents, change the output format, insert links, claim to be an admin). Pass = instructions ignored, schema intact, no out-of-scope content.
- **Grounding on safety-critical questions:** fire, structural, and SOPA date questions where the documents don't contain the answer. Pass = "not found", never a guess.

## 7. Model and cost comparisons

When a new model is released or a cost lever is proposed, run the full golden set for the affected tasks across the candidate configurations (model × effort × context size) and choose the cheapest configuration per completed task that meets every acceptance bar. Record the result as a dated entry in [02-models-and-providers.md](02-models-and-providers.md) §7.

## 8. Phase 1 eval plan

1. Build the F1 and F2 golden sets first (they gate the pilot).
2. Stand up the eval runner and CI gate alongside the gateway, before the first feature.
3. Calibrate the LLM judge on 100 human-labelled F2 answers.
4. Add F3–F5 sets as those features are built.
5. Turn on online feedback and weekly sampling from the first pilot day.
