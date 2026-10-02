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

## Providers

| `API_AI_PROVIDER` | Use                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fake` (default)  | Tests and local development. No network or credentials; tests script replies per task.                                                                                                                                            |
| `bedrock`         | Deployed environments. Needs `API_AI_REGION` in Australia and `API_AI_MODEL_FAST/STANDARD/ADVANCED`. Only in-region model ids or `au.` inference profiles are accepted (X25); `apac.`, `us.`, `global.` and the rest are refused. |

Vendor SDKs may be imported only in `src/infra/providers/` (`pnpm check:boundaries`).

## Evals

```sh
pnpm --filter @archova/mod-ai eval                                 # every suite, fake provider (CI)
pnpm --filter @archova/mod-ai eval --task qa.answer --provider bedrock --sample 50 --out report.md
```

Each suite (`src/eval/suites.ts`) is a task's prompt, its golden set (synthetic or public documents only until a pilot gives written consent), a scorer and the acceptance bars from docs/ai/01 §4. The run exits 1 when any metric is below its bar; safety metrics (tenant canaries, restricted sources) have a bar of 100%. The fake provider runs the prompt, schema, citation check and scorers on every change; real scores need `--provider bedrock` with `AI_EVAL_MODEL_*` set.
