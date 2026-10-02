// Parsing model output. Features never parse free text (ai/03 §6): the gateway turns the provider's JSON text
// into the task's typed output or reports why it couldn't.
import type { PromptDefinition } from '@archova/ai-prompts';

export type ParsedOutput<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accepts bare JSON, or JSON inside a single ```json fence (some models add one despite instructions). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}

export function parseOutput<T>(
  def: Pick<PromptDefinition<unknown, T>, 'output'>,
  text: string,
): ParsedOutput<T> {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  const r = def.output.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      error: `schema: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    };
  }
  return { ok: true, value: r.data };
}
