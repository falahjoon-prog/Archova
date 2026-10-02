# AI features and priorities

**Owner:** Ari · **Status:** Draft v1 · **Last updated:** 2 Oct 2026

## 1. How features were prioritised

Each candidate was scored on four things, then lined up against the module phases in [plan.md §6](../../plans/plan.md):

- **Time saved per week** for a PM, site manager or contract admin at a mid-size AU builder.
- **Risk if wrong.** Low-risk outputs (tags, summaries a person reads) ship first; outputs with contractual or legal weight (claims, payment schedules) come later and stay advisory.
- **Data available.** A feature can only ship once the module it reads from exists.
- **Cost per use.** Cheap, high-volume features are fine at scale; expensive ones need tighter limits (see [05-cost-control.md](05-cost-control.md)).

Priority labels: **P0** = in the phase 1 pilot, **P1** = phase 1–2, **P2** = phase 3, **P3** = phase 4–5.

## 2. Feature list

| # | Feature | What the user gets | Module | Priority | Phase | Model tier | Risk |
|---|---|---|---|---|---|---|---|
| F1 | **Drawing register auto-fill** | Upload a drawing set; the drawing number, title, revision, discipline, date and scale are read from each sheet's title block and filled in. Revisions are matched to existing drawings and older ones marked superseded (after confirmation). | Drawings | P0 | 1 | Fast (vision) | Low |
| F2 | **Ask the project** (document and drawing Q&A) | Ask "What fire rating is the level 3 corridor wall?" or "Which spec section covers waterproofing to wet areas?" and get an answer with links to the exact document, revision and page. Says "not found in the project documents" rather than guessing. Only current revisions by default. | Documents, drawings, specs, RFIs | P0 | 1 | Standard | Medium |
| F3 | **RFI auto-draft** | From a question typed in plain words, a drawing markup or a site photo, draft the RFI subject and question, suggest the drawing/spec references, the assignee (consultant by discipline) and a due date, and flag similar RFIs already asked on this project. | RFIs | P0 | 1 | Standard | Low (person sends) |
| F4 | **Site diary summaries** | One-click daily report from the day's diary entries, labour, plant, delays and photos; a weekly summary for the client or head office; delay entries tagged by cause (weather, late information, subcontractor, client variation) so they can support an extension of time later. | Site diary | P0 | 1 | Fast / Standard | Low |
| F5 | **Defect photo tagging** | From a defect photo, suggest the trade, defect type (e.g. paint finish, sealant, tiling lippage, damaged door), location from the pinned drawing, a short title and description, and the subcontractor to assign it to. Spot duplicates of existing open defects nearby. | Defects | P0 | 1 | Fast (vision) | Low |
| F6 | **Semantic search** | Search across documents, RFIs, diary, defects and correspondence by meaning, not just keywords ("anything about the basement leak"). Blends with the normal OpenSearch keyword search. | Platform search | P1 | 1 | Embeddings only | Low |
| F7 | **Meeting minutes to actions** | Paste notes or upload a meeting recording transcript; get structured minutes, decisions and action items with owners and dates, ready to accept into the meetings module. | Meetings | P1 | 1 | Standard | Low |
| F8 | **Risk alerts** | Daily project health digest: overdue RFIs blocking work, defects ageing past due, repeated delay causes, drawings superseded after work started, submittals waiting too long, unusual quiet periods. Rules find the signals; AI explains them in plain words and ranks them. | Cross-module | P1 | 2 | Standard | Medium (advisory) |
| F9 | **Inspection and observation helpers** | Generate an inspection checklist from a spec section or ITP; classify observations and incidents (hazard type, severity) for WHS reporting; draft corrective actions. | Quality & safety | P1 | 2 | Fast / Standard | Medium |
| F10 | **Correspondence and transmittal drafting** | Draft a letter or transmittal cover note from context, in the builder's tone, citing the relevant documents. | Correspondence | P1 | 2 | Standard | Low (person sends) |
| F11 | **Submittal spec check** | Compare a submitted product data sheet against the spec section and list where it complies, doesn't, or can't be confirmed. | Submittals | P2 | 2–3 | Advanced | Medium (advisory) |
| F12 | **Variation drafting** | Draft a variation description and supporting narrative from an RFI response, instruction or change event, with linked evidence. Amounts are entered by a person. | Financials | P2 | 3 | Standard | Medium |
| F13 | **Progress claim review assistant** | Before a claim is submitted or a payment schedule issued, flag claim lines that look out of step with recorded progress (diary, photos, inspections), missing variations, arithmetic or GST/retention inconsistencies, and SOPA deadlines. Advisory only; never drafts the legal wording of a schedule. | Financials (SOPA) | P2 | 3 | Advanced | High (advisory only) |
| F14 | **Voice to diary and defects (mobile)** | Speak on site; the app transcribes on the device and the server turns it into structured diary entries or defects for review. Works offline by queueing. | Mobile | P2 | 3 | Fast | Low |
| F15 | **Cost forecast narratives** | Plain-words commentary on budget versus forecast, what moved this month and why. | Financials | P2 | 3 | Standard | Medium |
| F16 | **Schedule risk and lookahead helper** | Flag activities at risk from open RFIs, late submittals or weather; draft 3-week lookaheads from the programme. | Scheduling | P3 | 4 | Advanced | Medium |
| F17 | **Tender leveling assistant** | Read subcontractor quotes, line them up against the tender package scope, highlight exclusions and gaps. | Preconstruction | P3 | 4 | Advanced | Medium |
| F18 | **Project copilot (agent)** | One chat panel that can look things up across modules and *propose* actions (create RFI, assign defects, schedule meeting), each shown for confirmation before it runs. | Cross-module | P3 | 4–5 | Advanced | Medium (confirm every action) |
| F19 | **BIM coordination summaries** | Summarise clash reports and coordination issues, link them to RFIs. | Design coordination | P3 | 5 | Standard | Low |

**Model tiers** are defined in [02-models-and-providers.md](02-models-and-providers.md): *Fast* (Haiku 4.5), *Standard* (Sonnet 5.5), *Advanced* (Opus 5.5).

## 3. Why this order

- **F1 drawing register auto-fill is first** because it is cheap, low risk, and removes the most tedious job on every project (registering hundreds of sheets per drawing issue). It also produces the clean, structured drawing index that F2, F3 and F5 depend on.
- **F2 Ask the project** is the headline feature and what pilots will judge us on. It needs the ingestion pipeline (text extraction, chunking, embeddings), which every later feature reuses.
- **F3, F4, F5** each remove daily admin from a specific role (PM, site manager, defects manager) and every output is reviewed by a person before it goes anywhere.
- **F6–F10** reuse the same pipeline and patterns, so their marginal cost to build is low once F1–F5 exist.
- **Financial and SOPA features (F12, F13) wait for phase 3** and stay advisory. A wrong AI statement in a payment schedule could cost a builder an adjudication. Legal review of the wording (plan §2) is required before F13 ships.
- **The agent (F18) is last.** Agents that take actions need mature permissions, audit and evals on every tool they call; those come from building F1–F17 first.

## 4. What each P0 feature needs to be "done"

| Feature | Acceptance bar for pilot (measured as in [06-evaluation.md](06-evaluation.md)) |
|---|---|
| F1 Drawing register | ≥ 97% of title block fields correct on the AU drawing golden set; every low-confidence field highlighted for review, never silently filled |
| F2 Ask the project | ≥ 90% of golden questions answered correctly with a correct citation; ≥ 95% "not found" on questions the documents can't answer; zero answers from documents the user can't access |
| F3 RFI draft | ≥ 70% of drafts sent with light or no edits in pilot; correct drawing reference suggested ≥ 80% |
| F4 Diary summary | No invented facts (every statement traceable to an entry) on 100% of the golden set; ≥ 80% rated "usable as is" by pilot site managers |
| F5 Defect tagging | Trade correct ≥ 85% top-1, ≥ 95% top-3; suggested assignee accepted ≥ 75% |

## 5. Explicitly out of scope

- Generating drawings, designs or engineering calculations.
- Giving legal advice on SOPA, contracts or disputes. F13 flags inconsistencies and deadlines; it does not interpret the Act.
- Automatically sending anything to another party.
- Training our own foundation model. We fine-tune nothing in phase 1–3; prompts, retrieval and evals get us there (revisit if a narrow model like defect tagging becomes a major cost line, see [05-cost-control.md](05-cost-control.md) §4).
