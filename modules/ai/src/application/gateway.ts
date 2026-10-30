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
import { endOfLocalDay, localDateOf, startOfLocalDay } from '@archova/time';
import type { CheckedCitation } from '../domain/citations';
import { TASK_CREDITS, creditsFor, decideBudget } from '../domain/credits';
import { ProviderError, type ModelProvider, type OcrResponse } from '../domain/provider';
import { OCR_MODEL, SPEECH_MODEL, type EmbeddingRoute, type RoutingTable } from '../domain/routing';
import { orgSettings, requests, usageLedger } from '../infra/tables';
import { invokePrompt, type CallRecord } from './invoke';
import { createOnceADay } from './once-a-day';

export interface GatewayDeps {
  database: Database;
  provider: ModelProvider;
  routing: RoutingTable;
  /** Embedding model for retrieval (ai/02 §6); one model per index, so changing it means re-indexing. */
  embedding: EmbeddingRoute;
  /** OCR price in US micro-dollars a page (ai/05 §1). */
  ocrPriceMicros?: number;
  /** Speech-to-text price in US micro-dollars a clip. */
  speechPriceMicros?: number;
  /** Tokens of documents and records an org may have embedded in a local day; defaults to `DEFAULT_EMBED_DAILY_TOKENS`. */
  embedDailyTokens?: number;
  /** Scanned pages an org may have read with OCR in a local day; defaults to `DEFAULT_OCR_DAILY_PAGES`. */
  ocrDailyPages?: number;
  redis: RedisClient | null;
  logger: Logger;
  /** The org's IANA zone, for the ledger day (X34). Supplied by `platform`. */
  orgTimeZone: (scope: TenantScope) => Promise<string>;
  credits?: Readonly<Record<string, number>>;
  /** Per-user limit on interactive runs (ai/05 §4): stops scripts and loops, not normal use. */
  rateLimit?: { runs: number; windowS: number };
  /** Per-user limit on query embeddings a person triggers by searching (F6): each pays for an embedding. */
  queryRateLimit?: { runs: number; windowS: number };
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

export interface OcrOptions {
  /** Feature the text serves, for the feature switch and the ledger (`ask`, `drawings`). */
  feature: string;
  projectId?: string | null;
  /**
   * A bulk job nobody is waiting on (the project index). It stops at `OCR_BULK_SHARE` of the daily page cap, leaving
   * the rest for scanned pages a person has asked for (quotes, sheet text, the drawing register).
   */
  bulk?: boolean;
}

export interface EmbedOptions {
  /** Documents are embedded when indexed; questions when asked. */
  purpose: 'document' | 'query';
  /** Feature the embeddings serve, for the feature switch and the ledger (`ask`). */
  feature: string;
  projectId?: string | null;
  /** Counts against the caller's per-user search limit; for embeddings a person triggers by typing a query. */
  rateLimited?: boolean;
  /**
   * Skips the org's daily cap on document embeddings. For the few texts one person's own action produces (an
   * induction published), which must not wait behind a bulk index; everything else is held to the cap.
   */
  uncapped?: boolean;
}

/**
 * Tokens of documents and records one org may have embedded in a local day (ai/05 §4). A backstop against a runaway
 * loop or a bulk re-index, not a budget: at list price (US$0.02 a million) it is about 50 cents an org a day, and a
 * normal day is a small fraction of it.
 */
export const DEFAULT_EMBED_DAILY_TOKENS = 25_000_000;

/**
 * Scanned pages one org may have read with OCR in a local day (ai/05 §4). The same kind of backstop as the embedding
 * cap, but a page costs far more than its embedding: at Textract's list price (US$1.50 per 1,000 pages) this is about
 * US$4.50 an org a day. Priya and Sam to confirm.
 */
export const DEFAULT_OCR_DAILY_PAGES = 3_000;

/** Share of the daily OCR page cap a bulk job may use; the rest is kept for features a person is waiting on. */
export const OCR_BULK_SHARE = 0.8;

/** Texts per provider call; Titan takes one at a time anyway, Cohere up to 96. */
const EMBED_BATCH = 64;

const DEFAULT_RATE_LIMIT = { runs: 30, windowS: 600 };
/** Searches are cheaper than answers and may run as the person types, so the limit is looser: one every 5 s. */
const DEFAULT_QUERY_RATE_LIMIT = { runs: 120, windowS: 600 };
const DEFAULT_TIMEOUTS = { interactiveMs: 60_000, backgroundMs: 180_000 };

export function createGateway(deps: GatewayDeps) {
  const prices = deps.credits ?? TASK_CREDITS;
  const rateLimit = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  const queryRateLimit = deps.queryRateLimit ?? DEFAULT_QUERY_RATE_LIMIT;
  const timeouts = deps.timeouts ?? DEFAULT_TIMEOUTS;
  const now = deps.now ?? (() => new Date());
  const embedDailyTokens = deps.embedDailyTokens ?? DEFAULT_EMBED_DAILY_TOKENS;
  const ocrDailyPages = deps.ocrDailyPages ?? DEFAULT_OCR_DAILY_PAGES;
  const ocrBulkPages = Math.floor(ocrDailyPages * OCR_BULK_SHARE);
  const onceADay = createOnceADay(deps.redis);

  /**
   * Says in the log, once an org-day, that an org reached a daily cap (Jeff alerts on these lines). Ids and numbers
   * only. `resetsAt` changes each local day, so it stands for the day.
   */
  async function noteCap(
    orgId: string,
    task: string,
    err: AppError,
    cap: Record<string, number>,
    msg: string,
  ) {
    const resetsAt = String(err.extra?.resetsAt ?? '');
    if (!(await onceADay.first(orgId, task, resetsAt))) return;
    deps.logger.warn({ orgId, task, ...cap, resetsAt }, msg);
  }

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
    return { day, tz };
  }

  /**
   * Refuses document embeddings once the org has had `embedDailyTokens` embedded since its local day began. The cap is
   * read before the call, so a day can pass it by what the calls already running use, and it counts what was sent, so
   * a failed call that produced nothing does not.
   */
  async function assertEmbeddingRoom(scope: TenantScope, a: { day: string; tz: string }) {
    const [row] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${requests.tokensIn}), 0)` })
      .from(requests)
      .where(
        and(
          eq(requests.orgId, scope.ctx.orgId),
          eq(requests.task, 'embed.document'),
          gte(requests.createdAt, startOfLocalDay(a.day, a.tz)),
        ),
      );
    if (Number(row?.total ?? 0) < embedDailyTokens) return;
    throw new AppError(
      'ai.embedding_limit',
      'Nova has read as much as it can for your organisation today. It picks up again tomorrow, so try this again then.',
      undefined,
      { resetsAt: endOfLocalDay(a.day, a.tz).toISOString() },
    );
  }

  /**
   * Says whether reading these pages would take the org past its OCR line for its local day, and which line: the daily
   * cap, or for a bulk job the share of it kept back for features a person is waiting on. Pages are known up front
   * and dear, so the call must fit, with one exception: the first call of a day always runs, so a document longer
   * than the line can still be read once. Counts pages Textract read, not ones that failed.
   */
  async function ocrRefusal(
    scope: TenantScope,
    a: { day: string; tz: string },
    pages: number,
    bulk: boolean,
  ): Promise<'cap' | 'bulk' | null> {
    const [row] = await scope.tx
      .select({ n: sql<string>`count(*)` })
      .from(requests)
      .where(
        and(
          eq(requests.orgId, scope.ctx.orgId),
          eq(requests.task, 'ocr.page'),
          eq(requests.outcome, 'ok'),
          gte(requests.createdAt, startOfLocalDay(a.day, a.tz)),
        ),
      );
    const used = Number(row?.n ?? 0);
    if (used === 0) return null;
    if (used + pages > ocrDailyPages) return 'cap';
    return bulk && used + pages > ocrBulkPages ? 'bulk' : null;
  }

  async function creditsUsedSince(scope: TenantScope, fromDay: string): Promise<number> {
    const [row] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${usageLedger.credits}), 0)` })
      .from(usageLedger)
      .where(and(eq(usageLedger.orgId, scope.ctx.orgId), gte(usageLedger.day, fromDay)));
    return Number(row?.total ?? 0);
  }

  async function checkRateLimit(ctx: TenantContext, bucket = 'rl', limit = rateLimit) {
    if (!deps.redis) return;
    const window = Math.floor(now().getTime() / 1000 / limit.windowS);
    const key = tenantKey(ctx.orgId, 'ai', bucket, ctx.userId, String(window));
    const n = await deps.redis.incr(key);
    if (n === 1) await deps.redis.expire(key, limit.windowS);
    if (n > limit.runs)
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
   * switches, and logged and costed like any model call. Documents are also held to the org's daily token cap
   * (`ai.embedding_limit`); questions are not, since a person is waiting and the per-user search limit covers them.
   */
  async function embed(
    ctx: TenantContext,
    texts: readonly string[],
    opts: EmbedOptions,
  ): Promise<{ model: string; vectors: number[][] }> {
    const task = opts.purpose === 'query' ? 'embed.query' : 'embed.document';
    const prompt = { id: task, feature: opts.feature, version: 1, kind: 'background' as const };
    const ro = { readOnly: true } as const;
    const { day } = await deps.database
      .withTenantTx(
        ctx,
        async (s) => {
          const admitted = await admit(s, prompt, 0);
          if (opts.purpose === 'document' && !opts.uncapped) await assertEmbeddingRoom(s, admitted);
          return admitted;
        },
        ro,
      )
      .catch(async (err: unknown) => {
        if (err instanceof AppError && err.code === 'ai.embedding_limit')
          await noteCap(
            ctx.orgId,
            'embed.document',
            err,
            { capTokens: embedDailyTokens },
            'ai daily embedding cap reached',
          );
        throw err;
      });
    if (opts.rateLimited) await checkRateLimit(ctx, 'rlq', queryRateLimit);
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

  /**
   * Reads the text off scanned page images (ai/03 §3 step 2). Background work like embeddings: 0 credits and never
   * stopped by the allowance (ai/05 §4), but behind the org and feature switches, held to the org's daily page cap
   * (`ai.ocr_limit`; a bulk job stops sooner, at `OCR_BULK_SHARE` of it), and logged and costed per page.
   */
  async function ocr(
    ctx: TenantContext,
    images: readonly Uint8Array[],
    opts: OcrOptions,
  ): Promise<OcrResponse[]> {
    if (!images.length) return [];
    const prompt = {
      id: 'ocr.page',
      feature: opts.feature,
      version: 1,
      kind: 'background' as const,
    };
    const ro = { readOnly: true } as const;
    const { day, tz, refusal } = await deps.database.withTenantTx(
      ctx,
      async (s) => {
        const admitted = await admit(s, prompt, 0);
        return {
          ...admitted,
          refusal: await ocrRefusal(s, admitted, images.length, opts.bulk === true),
        };
      },
      ro,
    );
    if (refusal) {
      const resetsAt = endOfLocalDay(day, tz).toISOString();
      const err =
        refusal === 'cap'
          ? new AppError(
              'ai.ocr_limit',
              'Nova has read as many scanned pages as it can for your organisation today. It picks up again tomorrow, so try this again then.',
              undefined,
              { resetsAt },
            )
          : new AppError(
              'ai.ocr_limit',
              'Nova has read as many scanned pages for indexing as it can today, and is keeping the rest for scanned pages you ask about. Indexing picks up again tomorrow, so run it again then.',
              undefined,
              { resetsAt },
            );
      // The bulk share has its own task key and line, so an alert on the real cap stays clean.
      if (refusal === 'cap')
        await noteCap(
          ctx.orgId,
          'ocr.page',
          err,
          { capPages: ocrDailyPages },
          'ai daily ocr cap reached',
        );
      else
        await noteCap(
          ctx.orgId,
          'ocr.page.bulk',
          err,
          { capPages: ocrDailyPages, bulkPages: ocrBulkPages },
          'ai daily ocr bulk share reached',
        );
      throw err;
    }
    const price = deps.ocrPriceMicros ?? DEFAULT_OCR_PRICE_MICROS;
    const results: OcrResponse[] = [];
    const calls: CallRecord[] = [];
    let failure: ProviderError | null = null;
    for (const image of images) {
      const started = Date.now();
      try {
        results.push(await deps.provider.detectText({ image, timeoutMs: timeouts.backgroundMs }));
        calls.push(ocrCall(price, started, null));
      } catch (e) {
        failure = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e));
        calls.push(ocrCall(0, started, failure.kind));
        break;
      }
    }
    await deps.database.withTenantTx(ctx, (scope) =>
      record(scope, {
        prompt,
        runId: uuidv7(),
        projectId: opts.projectId ?? null,
        day,
        calls,
        credits: 0,
        totalCost: calls.reduce((n, c) => n + c.costMicros, 0),
      }),
    );
    if (failure) throw new AppError('ai.unavailable', 'Nova is busy right now. Try again shortly.');
    return results;
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

  /**
   * Turns one short spoken clip into text (Nova listening). An interactive call like any other: behind the org and
   * feature switches and the monthly allowance, logged and costed, and charged `speech.transcribe` credits when the
   * speech service answers. A failed call costs nothing.
   */
  async function transcribe(
    ctx: TenantContext,
    clip: { audio: Uint8Array; mimeType: string; projectId?: string | null; language?: string },
  ): Promise<{ runId: string; text: string }> {
    const prompt = {
      id: 'speech.transcribe',
      feature: 'voice_input',
      version: 1,
      kind: 'interactive' as const,
    };
    const credits = creditsFor('speech.transcribe', prices);
    const { day } = await deps.database.withTenantTx(ctx, (s) => admit(s, prompt, credits), {
      readOnly: true,
    });
    const started = Date.now();
    let text = '';
    let failure: ProviderError | null = null;
    try {
      text = (
        await deps.provider.transcribe({
          audio: clip.audio,
          mimeType: clip.mimeType,
          language: clip.language ?? 'en-AU',
          timeoutMs: timeouts.interactiveMs,
        })
      ).text.trim();
    } catch (e) {
      failure = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e));
    }
    const runId = uuidv7();
    const costMicros = failure ? 0 : (deps.speechPriceMicros ?? DEFAULT_SPEECH_PRICE_MICROS);
    await deps.database.withTenantTx(ctx, (scope) =>
      record(scope, {
        prompt,
        runId,
        projectId: clip.projectId ?? null,
        day,
        calls: [speechCall(costMicros, started, failure?.kind ?? null)],
        credits: failure ? 0 : credits,
        totalCost: costMicros,
      }),
    );
    if (failure)
      throw new AppError(
        'ai.unavailable',
        'Nova cannot listen right now. Type your question instead.',
      );
    return { runId, text };
  }

  return { runTask, embed, ocr, transcribe, creditsUsedSince };
}

/** Textract DetectDocumentText list price, US$1.50 per 1,000 pages; confirm the Sydney price (ai/05 §1). */
export const DEFAULT_OCR_PRICE_MICROS = 1500;

/** Amazon Transcribe list price, about US$0.024 a minute, billed at least 15 seconds a clip; confirm the Sydney price (ai/05 §1). */
export const DEFAULT_SPEECH_PRICE_MICROS = 6000;

function speechCall(costMicros: number, started: number, errorKind: string | null): CallRecord {
  return {
    id: uuidv7(),
    tier: 'speech',
    model: SPEECH_MODEL,
    attempt: 1,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costMicros,
    latencyMs: Date.now() - started,
    outcome: errorKind ? 'error' : 'ok',
    errorKind,
  };
}

function ocrCall(costMicros: number, started: number, errorKind: string | null): CallRecord {
  return {
    id: uuidv7(),
    tier: 'ocr',
    model: OCR_MODEL,
    attempt: 1,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costMicros,
    latencyMs: Date.now() - started,
    outcome: errorKind ? 'error' : 'ok',
    errorKind,
  };
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
