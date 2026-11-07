// Project home insights, follow-up: the checks between the model and the person. Pure, no IO. Nova only discusses
// notes that code produced; a sentence is kept only when it cites facts we supplied and every number in it is in them.
import type { InsightsDiscussInput, InsightsDiscussOutput } from '@archova/ai-prompts';
import { normaliseForMatch } from './citations';
import { numbersIn } from './diary-summary';

/** One note as `reporting.api.projectInsights` returns it. */
export interface InsightNote {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  facts: readonly string[];
}

export const NOTHING_TO_DISCUSS =
  'Nothing on this project needs attention right now, so there is nothing to discuss. Ask again when a note appears.';
export const NOT_IN_FIGURES =
  "I can't answer that from the project's current figures. Try asking about one of the notes above, or check the records directly.";

export function discussInput(
  notes: readonly InsightNote[],
  question: string,
  focus: string | null,
  history: InsightsDiscussInput['history'],
): InsightsDiscussInput {
  const focused = notes.find((n) => n.id === focus);
  return {
    question,
    focus: focused ? focused.id : null,
    insights: notes.slice(0, 8).map((n) => ({
      id: n.id,
      severity: n.severity,
      title: n.title,
      detail: n.detail,
      facts: n.facts.slice(0, 8) as string[],
    })),
    history,
  };
}

/** Fact id → text, ids as the prompt shows them (`budget.1`). */
export function factTable(notes: readonly InsightNote[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of notes.slice(0, 8))
    n.facts.slice(0, 8).forEach((f, i) => out.set(`${n.id}.${i + 1}`, f));
  return out;
}

export interface ReviewedDiscussion {
  grounded: boolean;
  answer: string;
  suggestions: string[];
  dropped: number;
}

export function reviewDiscussion(
  out: InsightsDiscussOutput,
  notes: readonly InsightNote[],
): ReviewedDiscussion {
  const facts = factTable(notes);
  // A note's own title and detail may be quoted too, so their numbers are allowed alongside the cited facts.
  const noteText = new Map(notes.map((n) => [n.id, `${n.title} ${n.detail}`]));
  let dropped = 0;
  const keep = (lines: InsightsDiscussOutput['sentences']) =>
    lines.flatMap((s) => {
      const ids = [...new Set(s.sources)].filter((id) => facts.has(id));
      const hay = normaliseForMatch(
        ids
          .flatMap((id) => [facts.get(id)!, noteText.get(id.split('.')[0]!) ?? ''])
          .join('\n')
          .replace(/,/g, ''),
      ).replace(/\s+/g, '');
      if (!ids.length || !numbersIn(s.text).every((n) => hay.includes(n))) {
        dropped++;
        return [];
      }
      return [s.text.trim()];
    });
  const sentences = keep(out.sentences);
  const suggestions = keep(out.options);
  return {
    grounded: sentences.length > 0,
    answer: sentences.length ? sentences.join(' ') : NOT_IN_FIGURES,
    // Options without an answer to hang on are not shown on their own.
    suggestions: sentences.length ? suggestions : [],
    dropped,
  };
}
