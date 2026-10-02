// Offline eval harness (ai/06). A suite is a task's prompt, its golden set and a scorer; the runner sends every
// case through the same `invokePrompt` production uses and compares mean scores with the task's acceptance bars
// (ai/01 §4). Golden sets are synthetic or public documents only until a pilot gives written consent (ai/06 §2).
import type { PromptDefinition, PromptPassage } from '@archova/ai-prompts';
import { invokePrompt, type InvokeOutcome } from '../application/invoke';
import type { ModelProvider } from '../domain/provider';
import type { FakeResponder } from '../infra/providers/fake';
import type { RoutingTable } from '../domain/routing';

export interface GoldenCase<I, E> {
  id: string;
  input: I;
  /** Retrieved passages for tasks that answer from documents. */
  passages?: PromptPassage[];
  expected: E;
  tags?: readonly string[];
}

/** A metric's score for one case: 0–1, or null when it doesn't apply to that case. */
export type CaseScores = Record<string, number | null>;

export interface CaseResult<O> {
  outcome: InvokeOutcome<O>;
  costMicros: number;
  latencyMs: number;
  calls: number;
}

export interface EvalSuite<I, O, E> {
  prompt: PromptDefinition<I, O>;
  /** Where the golden set came from, printed on the report (ai/06 §2 data source rule). */
  source: string;
  cases: readonly GoldenCase<I, E>[];
  score(c: GoldenCase<I, E>, r: CaseResult<O>): CaseScores;
  /**
   * Minimum mean per metric (0–1). Safety metrics (tenant canaries, restricted sources, injections) use 1:
   * one failure fails the run (ai/06 §6).
   */
  bars: Readonly<Record<string, number>>;
  /**
   * Deterministic stand-in used with `--provider fake` in CI, so the prompt, schema, citation check and scorers
   * run on every change without a model or AWS credentials. Real scores come from `--provider bedrock`.
   */
  fake?: FakeResponder;
}

export interface MetricSummary {
  metric: string;
  mean: number | null;
  cases: number;
  bar: number | null;
  passed: boolean;
}

export interface EvalReport {
  task: string;
  promptVersion: number;
  provider: string;
  source: string;
  cases: number;
  metrics: MetricSummary[];
  schemaValidRate: number;
  refusalRate: number;
  costMicrosPerCase: number;
  latencyMs: { p50: number; p95: number };
  failures: Array<{ caseId: string; metric: string; score: number }>;
  gate: 'all' | 'safety';
  passed: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

export async function runSuite<I, O, E>(
  suite: EvalSuite<I, O, E>,
  deps: {
    provider: ModelProvider;
    routing: RoutingTable;
    /** Run only the first n cases (CI sample, ai/06 §4). */
    sample?: number;
    concurrency?: number;
    /**
     * `all` (default) gates on every bar. `safety` gates only on safety bars (100%) and schema validity: used with
     * the fake provider, whose quality scores mean nothing.
     */
    gate?: 'all' | 'safety';
  },
): Promise<EvalReport> {
  const cases = deps.sample ? suite.cases.slice(0, deps.sample) : suite.cases;
  const results: Array<{ c: GoldenCase<I, E>; r: CaseResult<O>; scores: CaseScores }> = [];
  const queue = [...cases];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const started = performance.now();
      const run = await invokePrompt(deps.provider, deps.routing, suite.prompt, c.input, {
        ...(c.passages ? { passages: c.passages } : {}),
        timeoutMs: 180_000,
        allowFallback: false,
      });
      const r: CaseResult<O> = {
        outcome: run.outcome,
        costMicros: run.costMicros,
        latencyMs: Math.round(performance.now() - started),
        calls: run.calls.length,
      };
      results.push({ c, r, scores: suite.score(c, r) });
    }
  };
  await Promise.all(Array.from({ length: deps.concurrency ?? 4 }, worker));
  results.sort((a, b) => cases.indexOf(a.c) - cases.indexOf(b.c));

  const metricNames = [
    ...new Set([...Object.keys(suite.bars), ...results.flatMap((x) => Object.keys(x.scores))]),
  ];
  const gated = (bar: number | null) => bar !== null && (deps.gate !== 'safety' || bar >= 1);
  const metrics: MetricSummary[] = metricNames.map((metric) => {
    const values = results
      .map((x) => x.scores[metric])
      .filter((v): v is number => typeof v === 'number');
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    const bar = suite.bars[metric] ?? null;
    return {
      metric,
      mean,
      cases: values.length,
      bar,
      passed: !gated(bar) || (mean !== null && mean >= bar! - 1e-9),
    };
  });
  const failures = results.flatMap((x) =>
    Object.entries(x.scores)
      .filter(([, v]) => typeof v === 'number' && v < 1)
      .map(([metric, v]) => ({ caseId: x.c.id, metric, score: v as number })),
  );
  const n = results.length || 1;
  const schemaValidRate = results.filter((x) => x.r.outcome.kind === 'ok').length / n;
  const latencies = results.map((x) => x.r.latencyMs).sort((a, b) => a - b);
  return {
    task: suite.prompt.id,
    promptVersion: suite.prompt.version,
    provider: deps.provider.name,
    source: suite.source,
    cases: results.length,
    metrics,
    schemaValidRate,
    refusalRate: results.filter((x) => x.r.outcome.kind === 'refused').length / n,
    costMicrosPerCase: Math.round(results.reduce((s, x) => s + x.r.costMicros, 0) / n),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    failures,
    gate: deps.gate ?? 'all',
    passed: metrics.every((m) => m.passed) && (deps.gate !== 'safety' || schemaValidRate === 1),
  };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

/** Markdown report for the pull request (ai/06 §4). */
export function formatReport(r: EvalReport): string {
  const lines = [
    `### Eval: \`${r.task}\` v${r.promptVersion} (${r.provider}) ${r.passed ? 'passed' : 'FAILED'}` +
      (r.gate === 'safety' ? ' (safety bars only: quality needs a real model)' : ''),
    '',
    `${r.cases} cases from ${r.source}. Schema-valid ${pct(r.schemaValidRate)}, refusals ${pct(r.refusalRate)}, ` +
      `US$${(r.costMicrosPerCase / 1e6).toFixed(4)} per case, latency p50 ${r.latencyMs.p50} ms / p95 ${r.latencyMs.p95} ms.`,
    '',
    '| Metric | Score | Bar | Cases | |',
    '|---|---|---|---|---|',
    ...r.metrics.map(
      (m) =>
        `| ${m.metric} | ${pct(m.mean)} | ${m.bar === null ? '' : pct(m.bar)} | ${m.cases} | ${m.passed ? (m.bar !== null && m.mean !== null && m.mean < m.bar ? 'not gated' : 'ok') : 'below bar'} |`,
    ),
  ];
  if (r.failures.length) {
    lines.push('', `Failures (${r.failures.length}, first 20):`);
    for (const f of r.failures.slice(0, 20))
      lines.push(`- ${f.caseId}: ${f.metric} ${pct(f.score)}`);
  }
  return lines.join('\n');
}
