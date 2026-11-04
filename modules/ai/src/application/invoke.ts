// Steps 4–7 of the gateway (ai/03 §1): render the prompt, route by tier, call the provider with retries and
// fallback, validate the output against the task's schema and check citations. No database or tenant state, so the
// eval runner (ai/06) exercises exactly the code production uses.
import {
  outputJsonSchema,
  type ModelTier,
  type PromptDefinition,
  type PromptPassage,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { checkCitations, type CheckedCitation } from '../domain/citations';
import { parseOutput } from '../domain/output';
import {
  NO_USAGE,
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelUsage,
} from '../domain/provider';
import { FALLBACK_TIER, costMicros, type RoutingTable } from '../domain/routing';

export type CallOutcome = 'ok' | 'refused' | 'error' | 'fallback';

/** One model call, as recorded in `ai.ai_requests`. */
export interface CallRecord {
  id: string;
  /** `embedding` and `ocr` for calls that have no tier. */
  tier: ModelTier | 'embedding' | 'ocr' | 'speech';
  model: string;
  attempt: number;
  usage: ModelUsage;
  costMicros: number;
  latencyMs: number;
  outcome: CallOutcome;
  errorKind: string | null;
}

export type InvokeOutcome<O> =
  | {
      kind: 'ok';
      output: O;
      tier: ModelTier;
      citations: CheckedCitation[];
      invalidCitations: number;
    }
  | { kind: 'refused' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; lastError: ProviderError | null };

export interface InvokeResult<O> {
  outcome: InvokeOutcome<O>;
  calls: CallRecord[];
  costMicros: number;
  /** Passages the model saw, for callers that show sources. */
  passages: readonly PromptPassage[];
}

export interface InvokeOptions {
  passages?: readonly PromptPassage[];
  signal?: AbortSignal;
  timeoutMs: number;
  /** Interactive work falls back to the next tier; background work waits and retries later (ai/02 §4). */
  allowFallback: boolean;
}

export async function invokePrompt<I, O>(
  provider: ModelProvider,
  routing: RoutingTable,
  prompt: PromptDefinition<I, O>,
  input: I,
  opts: InvokeOptions,
): Promise<InvokeResult<O>> {
  const rendered = prompt.render(input);
  const passages = [...(rendered.passages ?? []), ...(opts.passages ?? [])];
  const base: Omit<ModelRequest, 'model'> = {
    task: prompt.id,
    system: prompt.system,
    text: rendered.text,
    passages,
    images: rendered.images ?? [],
    outputSchema: outputJsonSchema(prompt),
    maxOutputTokens: prompt.maxOutputTokens,
    timeoutMs: opts.timeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const fallbackTier = opts.allowFallback ? FALLBACK_TIER[prompt.tier] : null;
  const tiers: ModelTier[] = fallbackTier ? [prompt.tier, fallbackTier] : [prompt.tier];

  const calls: CallRecord[] = [];
  const done = (outcome: InvokeOutcome<O>): InvokeResult<O> => ({
    outcome,
    calls,
    costMicros: calls.reduce((s, c) => s + c.costMicros, 0),
    passages,
  });
  let lastError: ProviderError | null = null;

  for (const tier of tiers) {
    const route = routing[tier];
    // One retry per tier, for provider errors and for output that fails the schema (ai/02 §4, ai/03 §6).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = performance.now();
      const call: CallRecord = {
        id: uuidv7(),
        tier,
        model: route.model,
        attempt: calls.length + 1,
        usage: NO_USAGE,
        costMicros: 0,
        latencyMs: 0,
        outcome: 'error',
        errorKind: null,
      };
      calls.push(call);
      try {
        const res = await provider.complete({ ...base, model: route.model });
        call.usage = res.usage;
        call.costMicros = costMicros(res.usage, route.price);
        call.latencyMs = Math.round(performance.now() - started);
        if (res.stop === 'refusal') {
          call.outcome = 'refused';
          return done({ kind: 'refused' });
        }
        if (res.stop === 'max_tokens') {
          call.errorKind = 'max_tokens';
          continue;
        }
        const parsed = parseOutput(prompt, res.text);
        if (!parsed.ok) {
          call.errorKind = `invalid_output:${parsed.error}`.slice(0, 200);
          continue;
        }
        call.outcome = tier === prompt.tier ? 'ok' : 'fallback';
        // Citations must point at passages we supplied, and quote them (ai/03 §4 step 6).
        const check = prompt.citations
          ? checkCitations(prompt.citations(parsed.value), passages)
          : { valid: [], invalid: [] };
        return done({
          kind: 'ok',
          output: parsed.value,
          tier,
          citations: check.valid,
          invalidCitations: check.invalid.length,
        });
      } catch (e) {
        call.latencyMs = Math.round(performance.now() - started);
        if (opts.signal?.aborted) {
          call.errorKind = 'cancelled';
          return done({ kind: 'cancelled' });
        }
        if (!(e instanceof ProviderError)) throw e;
        call.errorKind = e.kind;
        lastError = e;
        if (!e.retryable) return done({ kind: 'failed', lastError });
      }
    }
  }
  return done({ kind: 'failed', lastError });
}
