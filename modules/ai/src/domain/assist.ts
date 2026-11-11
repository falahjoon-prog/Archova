// Nova's toolbox (ai/07 §3, ai/03 §4): read-only lookups the modules register, run by code as the person asking.
// The model only picks which tool and which arguments; everything it may call is checked here first, and what the
// tools return reaches it as cited passages, never as instructions (ai/04 §6).
import type { AssistToolSpec, PromptPassage } from '@archova/ai-prompts';
import { MAX_PLAN_CALLS } from '@archova/ai-prompts';
import type { TenantScope } from '@archova/kernel';

/** What a tool found: one block of text the answer may cite. */
export interface ToolFinding {
  /** Shown as the citation's label, e.g. "Overdue RFIs". */
  title: string;
  /** What kind of record it came from (`rfi`, `budget`, `programme`); the client turns it into a link. */
  type: string;
  /** The record's own id when the finding is about one record, otherwise the project's. */
  id: string;
  text: string;
}

/**
 * A read-only lookup a module registers (compose builds the list from the module APIs). It must go through the
 * module's own permission-checked API, return `restricted` text rather than throw when the caller cannot see
 * something, and never change anything. Arguments arrive as short strings; the tool validates them.
 */
export interface NovaTool {
  name: string;
  description: string;
  params: Record<string, string>;
  run(
    scope: TenantScope,
    projectId: string,
    args: Readonly<Record<string, string>>,
  ): Promise<ToolFinding[]>;
}

/** Most calls Nova may make for one question, over all planning rounds. */
export const MAX_TOTAL_CALLS = 6;
export const MAX_PLAN_ROUNDS = 2;
/** A finding is cut here so one tool cannot fill the answer's context. */
export const MAX_FINDING_CHARS = 4_000;

export function toolSpecs(tools: readonly NovaTool[]): AssistToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, params: t.params }));
}

export interface PlannedCall {
  tool: NovaTool;
  args: Record<string, string>;
  key: string;
}

/**
 * Keeps the calls the model asked for that are allowed: a registered tool, only its named arguments, no repeat of a
 * call already made, and within the question's budget. Anything else is dropped, not guessed at.
 */
export function acceptCalls(
  asked: ReadonlyArray<{ tool: string; args: Record<string, string> }>,
  tools: readonly NovaTool[],
  made: ReadonlySet<string>,
): PlannedCall[] {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out: PlannedCall[] = [];
  const seen = new Set(made);
  for (const c of asked.slice(0, MAX_PLAN_CALLS)) {
    const tool = byName.get(c.tool);
    if (!tool) continue;
    const args: Record<string, string> = {};
    for (const k of Object.keys(tool.params)) {
      const v = c.args[k];
      if (typeof v === 'string' && v.trim()) args[k] = v.trim().slice(0, 200);
    }
    const key = `${tool.name}(${Object.keys(args)
      .sort()
      .map((k) => `${k}=${args[k]}`)
      .join(', ')})`;
    if (seen.has(key) || seen.size >= MAX_TOTAL_CALLS) continue;
    seen.add(key);
    out.push({ tool, args, key });
  }
  return out;
}

/** Findings as passages, ids `t1`, `t2`…, continuing from `offset` so ids stay unique across rounds. */
export function findingPassages(
  findings: ReadonlyArray<ToolFinding>,
  offset: number,
): PromptPassage[] {
  return findings.map((f, i) => ({
    id: `t${offset + i + 1}`,
    source: { type: f.type, id: f.id, title: f.title },
    text: f.text.slice(0, MAX_FINDING_CHARS),
  }));
}

export const NOTHING_FOUND_ANSWER =
  "I couldn't find anything in Archova to answer that from. Try naming the module or record, or open the screen it's on.";
