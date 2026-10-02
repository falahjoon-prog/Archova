// The AI gateway (ai/03 §1): the one door every Nova feature goes through.
//   1 policy → 2 budget → 3 context (passed in by the feature) → 4 prompt → 5 route → 6 call → 7 validate → 8 record
// Database work happens in short tenant transactions before and after the model call; the call itself never runs
// inside a transaction.
import { and, eq, gte, sql } from 'drizzle-orm';
import type { ModelTier, PromptDefinition, PromptPassage } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { hasModule } from '@archova/domain/permissions';
import {
  AppError,
  tenantKey,
  type Database,
  type Logger,
  type RedisClient,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { localDateOf } from '@archova/time';
import type { CheckedCitation } from '../domain/citations';
import { TASK_CREDITS, creditsFor, decideBudget } from '../domain/credits';
import { ProviderError, type ModelProvider } from '../domain/provider';
import type { EmbeddingRoute, RoutingTable } from '../domain/routing';
import { orgSettings, requests, usageLedger } from '../infra/tables';
import { invokePrompt, type CallRecord } from './invoke';

export interface GatewayDeps {
  database: Database;
  provider: ModelProvider;
  routing: RoutingTable;
  /** Embedding model for retrieval (ai/02 §6); one model per index, so changing it means re-indexing. */
  embedding: EmbeddingRoute;
  redis: RedisClient | null;
  logger: Logger;
  /** The org's IANA zone, for the ledger day (X34). Supplied by `platform`. */
  orgTimeZone: (scope: TenantScope) => Promise<string>;
  credits?: Readonly<Record<string, number>>;
  /** Per-user limit on interactive runs (ai/05 §4): stops scripts and loops, not normal use. */
  rateLimit?: { runs: number; windowS: number };
  timeouts?: { interactiveMs: number; backgroundMs: number };
  now?: () => Date;
}

export interface RunOptions {
  projectId?: string | null;
  /** Passages the user may read, already permission-filtered by retrieval (ai/04 §3). */
  passages?: readonly PromptPassage[];
  /** Closing the Nova panel cancels the call (ai/03 §2). */
  signal?: AbortSignal;
}

export type TaskRun<O> =
  | {
      runId: string;
      status: 'ok';
      output: O;
      citations: CheckedCitation[];
      /** Citations dropped because they didn't match a supplied passage. */
      invalidCitations: number;
      credits: number;
      costMicros: number;
      tier: ModelTier;
      fallback: boolean;
    }
  | { runId: string; status: 'refused'; credits: 0; costMicros: number };

export interface EmbedOptions {
  /** Documents are embedded when indexed; questions when asked. */
  purpose: 'document' | 'query';
  /** Feature the embeddings serve, for the feature switch and the ledger (`ask`). */
  feature: string;
  projectId?: string | null;
}

/** Texts per provider call; Titan takes one at a time anyway, Cohere up to 96. */
const EMBED_BATCH = 64;

const DEFAULT_RATE_LIMIT = { runs: 30, windowS: 600 };
const DEFAULT_TIMEOUTS = { interactiveMs: 60_000, backgroundMs: 180_000 };

export function createGateway(deps: GatewayDeps) {
  const prices = deps.credits ?? TASK_CREDITS;
  const rateLimit = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  const timeouts = deps.timeouts ?? DEFAULT_TIMEOUTS;
  const now = deps.now ?? (() => new Date());

  /** Steps 1–2: is Nova on for this org, feature and caller, and is there allowance left? */
  async function admit(
    scope: TenantScope,
    prompt: Pick<PromptDefinition, 'feature' | 'kind'>,
    credits: number,
  ) {
    const ctx = scope.ctx;
    if (!hasModule(ctx.entitlements, 'ai'))
      throw new AppError('entitlement-required', 'Your plan does not include Nova.', undefined, {
        module: 'ai',
      });
    const [settings] = await scope.tx
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, ctx.orgId))
      .limit(1);
    if (settings && !settings.aiEnabled)
      throw new AppError('ai.disabled', 'Nova is turned off for this organisation.');
    if (settings?.featuresEnabled && !settings.featuresEnabled.includes(prompt.feature))
      throw new AppError('ai.feature_disabled', 'This Nova feature is turned off.', undefined, {
        feature: prompt.feature,
      });
    if (ctx.principalType === 'external' && settings && !settings.externalAiEnabled)
      throw new AppError('ai.disabled', 'Nova is not available to external companies here.');

    const tz = await deps.orgTimeZone(scope);
    const day = localDateOf(now(), tz);
    const used = await creditsUsedSince(scope, `${day.slice(0, 7)}-01`);
    const decision = decideBudget(prompt.kind, credits, {
      planAllowance: ctx.entitlements.limits['limit.ai_credits'] ?? null,
      orgCap: settings?.monthlyCreditCap ?? null,
      used,
    });
    if (!decision.allow)
      throw new AppError(
        'ai.allowance_used',
        "This month's Nova allowance is used up. An admin can add a top-up.",
      );
    return { day };
  }

  async function creditsUsedSince(scope: TenantScope, fromDay: string): Promise<number> {
    const [row] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${usageLedger.credits}), 0)` })
      .from(usageLedger)
      .where(and(eq(usageLedger.orgId, scope.ctx.orgId), gte(usageLedger.day, fromDay)));
    return Number(row?.total ?? 0);
  }

  async function checkRateLimit(ctx: TenantContext) {
    if (!deps.redis) return;
    const window = Math.floor(now().getTime() / 1000 / rateLimit.windowS);
    const key = tenantKey(ctx.orgId, 'ai', 'rl', ctx.userId, String(window));
    const n = await deps.redis.incr(key);
    if (n === 1) await deps.redis.expire(key, rateLimit.windowS);
    if (n > rateLimit.runs)
      throw new AppError('rate_limited', 'Too many Nova requests. Try again in a few minutes.');
  }

  async function runTask<I, O>(
    ctx: TenantContext,
    prompt: PromptDefinition<I, O>,
    rawInput: I,
    opts: RunOptions = {},
  ): Promise<TaskRun<O>> {
    const parsedInput = prompt.input.safeParse(rawInput);
    if (!parsedInput.success)
      throw new AppError('validation_failed', 'The request to Nova was not valid.');
    const credits = creditsFor(prompt.id, prices);
    const projectId = opts.projectId ?? null;
    const runId = uuidv7();

    const ro = { readOnly: true } as const;
    const { day } = await deps.database.withTenantTx(ctx, (s) => admit(s, prompt, credits), ro);
    if (prompt.kind === 'interactive') await checkRateLimit(ctx);

    // Steps 4–7: prompt, route, call, validate (invoke.ts).
    const run = await invokePrompt(deps.provider, deps.routing, prompt, parsedInput.data, {
      ...(opts.passages ? { passages: opts.passages } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeoutMs: prompt.kind === 'interactive' ? timeouts.interactiveMs : timeouts.backgroundMs,
      allowFallback: prompt.kind === 'interactive',
    });
    const { outcome, calls } = run;

    // Step 8: record every call; charge credits only for a completed run.
    const charged = outcome.kind === 'ok' ? credits : 0;
    await deps.database.withTenantTx(ctx, (scope) =>
      record(scope, {
        prompt,
        runId,
        projectId,
        day,
        calls,
        credits: charged,
        totalCost: run.costMicros,
      }),
    );
    deps.logger.info(
      {
        orgId: ctx.orgId,
        task: prompt.id,
        runId,
        calls: calls.length,
        outcome: outcome.kind,
        costMicros: run.costMicros,
      },
      'ai task run',
    );

    switch (outcome.kind) {
      case 'ok':
        return {
          runId,
          status: 'ok',
          output: outcome.output,
          citations: outcome.citations,
          invalidCitations: outcome.invalidCitations,
          credits,
          costMicros: run.costMicros,
          tier: outcome.tier,
          fallback: outcome.tier !== prompt.tier,
        };
      case 'refused':
        return { runId, status: 'refused', credits: 0, costMicros: run.costMicros };
      case 'cancelled':
        throw new AppError('ai.cancelled', 'The Nova request was cancelled.');
      case 'failed':
        if (outcome.lastError && !outcome.lastError.retryable)
          deps.logger.error(
            { task: prompt.id, kind: outcome.lastError.kind },
            'ai provider rejected request',
          );
        throw outcome.lastError
          ? new AppError('ai.unavailable', 'Nova is busy right now. Try again shortly.')
          : new AppError('ai.invalid_output', "Nova couldn't produce a usable answer. Try again.");
    }
  }

  /**
   * Embeds texts for retrieval. Background work at 0 credits (ai/05 §4) but still behind the org and feature
   * switches, and logged and costed like any model call.
   */
  async function embed(
    ctx: TenantContext,
    texts: readonly string[],
    opts: EmbedOptions,
  ): Promise<{ model: string; vectors: number[][] }> {
    const task = opts.purpose === 'query' ? 'embed.query' : 'embed.document';
    const prompt = { id: task, feature: opts.feature, version: 1, kind: 'background' as const };
    const ro = { readOnly: true } as const;
    const { day } = await deps.database.withTenantTx(ctx, (s) => admit(s, prompt, 0), ro);
    const { model, pricePerMTok } = deps.embedding;
    const vectors: number[][] = [];
    const calls: CallRecord[] = [];
    let failure: ProviderError | null = null;
    for (let i = 0; i < texts.length && !failure; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const started = Date.now();
      try {
        const res = await deps.provider.embed({
          model,
          texts: batch,
          purpose: opts.purpose,
          timeoutMs: timeouts.backgroundMs,
        });
        if (res.vectors.length !== batch.length)
          throw new ProviderError('invalid_request', 'Embedding count mismatch');
        vectors.push(...res.vectors);
        calls.push(embedCall(model, res.usage.inputTokens, pricePerMTok, started, null));
      } catch (e) {
        failure = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e));
        calls.push(embedCall(model, 0, pricePerMTok, started, failure.kind));
      }
    }
    const totalCost = calls.reduce((n, c) => n + c.costMicros, 0);
    await deps.database.withTenantTx(ctx, (scope) =>
      record(scope, {
        prompt,
        runId: uuidv7(),
        projectId: opts.projectId ?? null,
        day,
        calls,
        credits: 0,
        totalCost,
      }),
    );
    if (failure) throw new AppError('ai.unavailable', 'Nova is busy right now. Try again shortly.');
    return { model, vectors };
  }

  async function record(
    scope: TenantScope,
    r: {
      prompt: Pick<PromptDefinition, 'id' | 'feature' | 'version'>;
      runId: string;
      projectId: string | null;
      day: string;
      calls: CallRecord[];
      credits: number;
      totalCost: number;
    },
  ) {
    const orgId = scope.ctx.orgId;
    const last = r.calls.length - 1;
    if (r.calls.length) {
      await scope.tx.insert(requests).values(
        r.calls.map((c, i) => ({
          id: c.id,
          runId: r.runId,
          orgId,
          projectId: r.projectId,
          userId: scope.ctx.userId,
          task: r.prompt.id,
          feature: r.prompt.feature,
          promptVersion: r.prompt.version,
          provider: deps.provider.name,
          model: c.model,
          tier: c.tier,
          attempt: c.attempt,
          tokensIn: c.usage.inputTokens,
          tokensOut: c.usage.outputTokens,
          cacheRead: c.usage.cacheReadTokens,
          cacheWrite: c.usage.cacheWriteTokens,
          costMicros: c.costMicros,
          credits: i === last ? r.credits : 0,
          latencyMs: c.latencyMs,
          outcome: c.outcome,
          errorKind: c.errorKind,
        })),
      );
    }
    await scope.tx
      .insert(usageLedger)
      .values({
        orgId,
        day: r.day,
        feature: r.prompt.feature,
        credits: r.credits,
        costMicros: r.totalCost,
        runs: 1,
      })
      .onConflictDoUpdate({
        target: [usageLedger.orgId, usageLedger.day, usageLedger.feature],
        set: {
          credits: sql`${usageLedger.credits} + excluded.credits`,
          costMicros: sql`${usageLedger.costMicros} + excluded.cost_micros`,
          runs: sql`${usageLedger.runs} + 1`,
          updatedAt: sql`now()`,
        },
      });
  }

  return { runTask, embed, creditsUsedSince };
}

function embedCall(
  model: string,
  inputTokens: number,
  pricePerMTok: number,
  started: number,
  errorKind: string | null,
): CallRecord {
  return {
    id: uuidv7(),
    tier: 'embedding',
    model,
    attempt: 1,
    usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    // tokens × $/MTok is micro-dollars
    costMicros: Math.round(inputTokens * pricePerMTok),
    latencyMs: Date.now() - started,
    outcome: errorKind ? 'error' : 'ok',
    errorKind,
  };
}

export type Gateway = ReturnType<typeof createGateway>;
