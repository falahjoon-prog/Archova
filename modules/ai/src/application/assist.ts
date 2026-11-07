// The Nova panel with tools (ai/07 §3): the question arrives with the screen and record the person has open. A cheap
// planning step names read-only tools (the modules' own permission-checked APIs, run as the caller), code runs
// them, and one answer step replies from what they returned, citing it. Nothing is changed or sent.
import {
  assistAnswerPrompt,
  assistPlanPrompt,
  type AssistContext,
  type AssistTurn,
} from '@archova/ai-prompts';
import {
  AppError,
  type Database,
  type Logger,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import {
  MAX_PLAN_ROUNDS,
  NOTHING_FOUND_ANSWER,
  acceptCalls,
  findingPassages,
  toolSpecs,
  type NovaTool,
  type ToolFinding,
} from '../domain/assist';
import type { Gateway } from './gateway';
import type { SemanticSearchService } from './semantic-search';

export interface AssistDeps {
  database: Database;
  logger: Logger;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** Registered by the modules (compose); read-only. */
  tools: readonly NovaTool[];
  search: Pick<SemanticSearchService, 'search'>;
}

export interface AssistAnswer {
  runId: string | null;
  found: boolean;
  answer: string;
  citations: Array<{ type: string; id: string; title: string; quote: string }>;
  /** What Nova looked up, for the person to see: one line per tool call. */
  lookups: Array<{ tool: string; summary: string }>;
}

export const ASSIST_PERMISSION = 'ai.ask.use';

/** Searches the indexed documents, drawings, RFIs, defects and diary; built in because `ai` owns the index. */
function searchTool(search: Pick<SemanticSearchService, 'search'>): {
  spec: NovaTool;
  run: (ctx: TenantContext, projectId: string, q: string) => Promise<ToolFinding[]>;
} {
  return {
    spec: {
      name: 'search_records',
      description:
        'Search project documents, drawings, specifications, RFIs, defects and site diary days by meaning or keyword.',
      params: { query: 'A few words to search for. Required.' },
      run: async () => [],
    },
    run: async (ctx, projectId, query) => {
      const hits = await search.search(ctx, projectId, { query, limit: 6 });
      return hits.map((h) => ({
        title: `${h.reference ?? h.title}${h.revision ? ` ${h.revision}` : ''}`.slice(0, 120),
        type: h.sourceType,
        id: h.sourceId,
        text: h.snippet,
      }));
    },
  };
}

export function createAssistService(deps: AssistDeps) {
  const { database } = deps;
  const searching = searchTool(deps.search);
  const tools: readonly NovaTool[] = [searching.spec, ...deps.tools];

  async function runOne(
    ctx: TenantContext,
    projectId: string,
    tool: NovaTool,
    args: Record<string, string>,
  ): Promise<ToolFinding[]> {
    if (tool.name === 'search_records') {
      const q = args.query ?? '';
      return q ? searching.run(ctx, projectId, q) : [];
    }
    return database.withTenantTx(ctx, (scope) => tool.run(scope, projectId, args), {
      readOnly: true,
    });
  }

  async function ask(
    ctx: TenantContext,
    projectId: string,
    input: { question: string; context: AssistContext; history: AssistTurn[] },
    signal?: AbortSignal,
  ): Promise<AssistAnswer> {
    await database.withTenantTx(
      ctx,
      (scope) => deps.assert(scope, ASSIST_PERMISSION, { projectId }),
      {
        readOnly: true,
      },
    );
    const question = input.question.trim();
    const history = input.history.slice(-6);
    const opts = { projectId, ...(signal ? { signal } : {}) };

    const made = new Set<string>();
    const gathered: string[] = [];
    const lookups: AssistAnswer['lookups'] = [];
    const findings: ToolFinding[] = [];

    for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
      const plan = await deps.gateway.runTask(
        ctx,
        assistPlanPrompt,
        { question, context: input.context, history, tools: toolSpecs(tools), gathered },
        opts,
      );
      if (plan.status !== 'ok')
        throw new AppError('ai.invalid_output', "Nova couldn't work out where to look. Try again.");
      const calls = acceptCalls(plan.output.calls, tools, made);
      if (calls.length === 0) break;
      const results = await Promise.allSettled(
        calls.map((c) => runOne(ctx, projectId, c.tool, c.args)),
      );
      calls.forEach((c, i) => {
        made.add(c.key);
        const r = results[i]!;
        if (r.status === 'fulfilled') {
          findings.push(...r.value);
          const summary = r.value.length ? `${r.value.length} found` : 'nothing found';
          gathered.push(`${c.key}: ${summary}`);
          lookups.push({ tool: c.tool.name, summary });
        } else {
          // The person sees "could not look up"; the cause is for the logs. No arguments or record text.
          deps.logger.warn(
            {
              tool: c.tool.name,
              orgId: ctx.orgId,
              code: r.reason instanceof AppError ? r.reason.code : 'unexpected',
            },
            'nova tool failed',
          );
          gathered.push(`${c.key}: could not look up`);
          lookups.push({ tool: c.tool.name, summary: 'could not look up' });
        }
      });
    }

    if (findings.length === 0)
      return { runId: null, found: false, answer: NOTHING_FOUND_ANSWER, citations: [], lookups };

    const passages = findingPassages(findings, 0);
    const run = await deps.gateway.runTask(
      ctx,
      assistAnswerPrompt,
      { question, context: input.context, history },
      { ...opts, passages },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't answer that. Try again.");
    const citations = run.citations.map((c) => ({
      type: c.source.type,
      id: c.source.id,
      title: c.source.title,
      quote: c.quote,
    }));
    const found = run.output.found && citations.length > 0;
    return {
      runId: run.runId,
      found,
      answer: found ? run.output.answer : run.output.answer || NOTHING_FOUND_ANSWER,
      citations: found ? citations : [],
      lookups,
    };
  }

  return { ask, toolNames: () => tools.map((t) => t.name) };
}

export type AssistService = ReturnType<typeof createAssistService>;
