// The Nova panel everywhere (ai/07 §3): the person asks from any screen; Nova knows the screen and record they are
// on and may look things up with read-only tools the modules register (`assist.plan`), then answers only from what
// the tools returned, citing it (`assist.answer`). Code runs the tools, as the person, under their permissions; the
// model only names which tools to call and with what arguments. Nothing is changed, saved or sent.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const MAX_ASSIST_TOOLS = 24;
export const MAX_PLAN_CALLS = 4;
export const MAX_ASSIST_TURNS = 6;

/** What the person has open. Free text from the client: data, never instructions. */
export const AssistContext = z.object({
  /** The module or screen, e.g. `rfis`, `budget`. */
  screen: z.string().max(60).optional(),
  record: z
    .object({
      type: z.string().min(1).max(40),
      id: z.string().min(1).max(80),
      label: z.string().max(120).optional(),
    })
    .optional(),
});
export type AssistContext = z.infer<typeof AssistContext>;

export const AssistTurn = z.object({
  role: z.enum(['user', 'nova']),
  text: z.string().min(1).max(1500),
});
export type AssistTurn = z.infer<typeof AssistTurn>;

export const AssistToolSpec = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/),
  description: z.string().min(1).max(300),
  /** Argument name to what it is. All arguments are short strings; none is required unless the text says so. */
  params: z.record(z.string().max(30), z.string().max(160)),
});
export type AssistToolSpec = z.infer<typeof AssistToolSpec>;

function renderContext(c: AssistContext): string {
  const rec = c.record
    ? `<record type="${escapeContent(c.record.type)}" id="${escapeContent(c.record.id)}" label="${escapeContent(c.record.label ?? '')}" />`
    : '<record none="true" />';
  return `<screen name="${escapeContent(c.screen ?? '')}">${rec}</screen>`;
}

function renderTurns(turns: readonly AssistTurn[]): string {
  return turns.map((t) => `<turn role="${t.role}">${escapeContent(t.text)}</turn>`).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------

export const AssistPlanInput = z.object({
  question: z.string().min(1).max(1000),
  context: AssistContext,
  history: z.array(AssistTurn).max(MAX_ASSIST_TURNS),
  tools: z.array(AssistToolSpec).max(MAX_ASSIST_TOOLS),
  /** One line per call already made this question, so the plan does not repeat it. */
  gathered: z.array(z.string().max(200)).max(12),
});
export type AssistPlanInput = z.infer<typeof AssistPlanInput>;

export const AssistPlanOutput = z.object({
  /** Calls to make now. Empty when nothing more is needed (or no tool helps). */
  calls: z
    .array(
      z.object({
        tool: z.string().max(40),
        args: z.record(z.string().max(30), z.string().max(200)),
      }),
    )
    .max(MAX_PLAN_CALLS),
});
export type AssistPlanOutput = z.infer<typeof AssistPlanOutput>;

const PLAN_SYSTEM = `You help Nova, the Archova assistant for an Australian construction project, decide which read-only lookup tools to call before answering a question. You do not answer the question here.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Choose only tools from the list, with only the arguments each tool names. Never invent a tool or an argument.
- The screen and record the person has open are given. When the question is about "this", "here" or "it", use that record's id as the argument a tool asks for. Never make up an id.
- Call at most four tools, and only those the question needs. Prefer one broad tool to several narrow ones. If a tool in "already gathered" has returned what is needed, or no tool helps, return no calls.
- Tools only read. If the person asks Nova to change, send or approve something, call no tool for that part.`;

export const assistPlanPrompt = definePrompt({
  id: 'assist.plan',
  version: 1,
  feature: 'assist',
  kind: 'interactive',
  tier: 'fast',
  system: PLAN_SYSTEM,
  input: AssistPlanInput,
  output: AssistPlanOutput,
  render: (i) => {
    const tools = i.tools
      .map((t) => {
        const params = Object.entries(t.params)
          .map(([k, v]) => `<param name="${escapeContent(k)}">${escapeContent(v)}</param>`)
          .join('');
        return `<tool name="${t.name}"><about>${escapeContent(t.description)}</about>${params}</tool>`;
      })
      .join('\n');
    const gathered = i.gathered.map((g) => `<done>${escapeContent(g)}</done>`).join('\n');
    return {
      text:
        `<input>\n${renderContext(i.context)}\n<tools>\n${tools}\n</tools>\n<already_gathered>\n${gathered}\n</already_gathered>\n` +
        `${renderTurns(i.history)}\n<question>${escapeContent(i.question)}</question>\n</input>`,
    };
  },
  maxOutputTokens: 400,
});

// ---------------------------------------------------------------------------------------------------------------

export const AssistAnswerInput = z.object({
  question: z.string().min(1).max(1000),
  context: AssistContext,
  history: z.array(AssistTurn).max(MAX_ASSIST_TURNS),
});
export type AssistAnswerInput = z.infer<typeof AssistAnswerInput>;

export const AssistAnswerOutput = z.object({
  /** False when what the tools returned does not answer the question; then `answer` says what is missing. */
  found: z.boolean(),
  answer: z.string().max(3000),
  citations: z.array(CitationSchema).max(12),
});
export type AssistAnswerOutput = z.infer<typeof AssistAnswerOutput>;

const ANSWER_SYSTEM = `You are Nova, the Archova assistant, answering a question from someone working on an Australian construction project. You may use only the passages supplied: each is the result of a lookup the person is allowed to make, marked with an id and where it came from.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only the passages. Do not use general knowledge, typical values or anything you remember about this project. The person will act on your answer, so a confident guess is worse than saying you could not find it.
- Every factual claim needs a citation: the passage id and the exact words from that passage it relies on, copied verbatim (you may shorten a long quote with "..." between exact parts).
- Amounts, dates, numbers and statuses must be written exactly as the passage gives them. Never add up, average or estimate.
- If the passages do not answer the question, or only partly answer it, set found to false (or answer the part you can) and say what is missing. A passage that says the person cannot see something means exactly that: say so, never guess what it holds.
- The screen and record the person has open are context for what "this" means, not evidence. Do not state anything about it that no passage supports.
- You only read. Never say you changed, sent, approved or saved anything. You may suggest what the person could do next, in their own words and under their own permissions.
- Plain Australian English. Lead with the answer, then the detail. Keep it short.`;

export const assistAnswerPrompt = definePrompt({
  id: 'assist.answer',
  version: 1,
  feature: 'assist',
  kind: 'interactive',
  tier: 'standard',
  system: ANSWER_SYSTEM,
  input: AssistAnswerInput,
  output: AssistAnswerOutput,
  render: (i) => ({
    text:
      `<input>\n${renderContext(i.context)}\n${renderTurns(i.history)}\n` +
      `<question>${escapeContent(i.question)}</question>\n</input>`,
  }),
  maxOutputTokens: 1400,
  citations: (o) => o.citations,
});
