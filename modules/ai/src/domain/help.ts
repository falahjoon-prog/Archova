// Nova help (ai/07): what the model said, checked before it is shown. Links and addresses are stripped (the
// prompt forbids them, and a model reply must never carry one to a person), and tools are already limited to the
// fixed catalogue by the output schema.
import type { HelpExplainOutput } from '@archova/ai-prompts';

export interface ReviewedHelp {
  answer: string;
  steps: string[];
  tools: HelpExplainOutput['tools'];
}

// Web addresses, scheme links (javascript:, data:, file: and the like), emails and bare domains such as evil.example.
const LINK =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z][a-z0-9+.-]{1,20}):(?:\/\/)?[^\s,;)]+|\b[\w.-]+@[\w-]+\.[\w.]+\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b(?:\/\S*)?/gi;
const clean = (text: string) =>
  text
    .replace(LINK, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export function reviewHelp(output: HelpExplainOutput): ReviewedHelp {
  const answer = clean(output.answer);
  return {
    answer: answer || "I'm not sure. Contact support with the reference shown on screen.",
    steps: output.steps.map(clean).filter(Boolean),
    tools: [...new Set(output.tools)],
  };
}
