// "Make me an induction" is a request to do something, not a question about the records. Ask answers from documents,
// so for the things Nova drafts elsewhere it points at the screen that does it instead of searching and failing.

import type { AssistantScope } from '../components/AssistantScope';
import type { NovaAnswer } from './preview-answers';

const VERB = /\b(make|create|draft|write|generate|build|prepare|set up)\b/;

const DRAFTS: {
  match: RegExp;
  recordType: string;
  actionId?: string;
  here: string;
  elsewhere: string;
}[] = [
  {
    match: /\binductions?\b/,
    recordType: 'induction',
    actionId: 'draft',
    here: "I can draft it now: I'll read the project documents and draft the slides, script and quiz for you to review. Nothing changes until you take it in.",
    elsewhere:
      'I draft inductions from the Inductions screen: open an induction and choose "Draft with Nova". I\'ll read the project documents and draft the slides, script and quiz for you to review.',
  },
  {
    match: /\b(meeting )?minutes\b/,
    recordType: 'meeting',
    here: 'Use the "Draft with Nova" button on this meeting to turn your notes into minutes.',
    elsewhere: 'I draft minutes from a meeting: open the meeting and choose "Draft with Nova".',
  },
  {
    match: /\brfis?\b/,
    recordType: 'rfi',
    here: 'Use the "Draft with Nova" button on the RFI form to draft the question.',
    elsewhere: 'I draft RFIs from the new RFI form: choose "Draft with Nova" there.',
  },
];

/** Null when the question is an ordinary question to answer from the records. */
export function actionRedirect(question: string, scope: AssistantScope): NovaAnswer | null {
  const q = question.toLowerCase();
  if (
    !VERB.test(q) ||
    /^(what|which|how many|when|who|where|why|is|are|does|did)\b/.test(q.trim())
  ) {
    return null;
  }
  const hit = DRAFTS.find((d) => d.match.test(q));
  if (!hit) return null;
  return {
    kind: 'answer',
    text: scope.record?.type === hit.recordType ? hit.here : hit.elsewhere,
    citations: [],
    runId: null,
    ...(hit.actionId && scope.record?.type === hit.recordType
      ? { action: { id: hit.actionId, label: 'Draft with Nova' } }
      : {}),
  };
}
