// Registered eval suites, one per Nova task (ai/06 §2). Each feature PR adds its suite here.
import type { EvalSuite } from './harness';
import { drawingTitleBlockSuite } from './suites/drawing-titleblock';
import { inductionAskSuite } from './suites/induction-ask';
import { inductionDraftSuite } from './suites/induction-draft';
import { qaAnswerSuite } from './suites/qa-answer';
import { qaRerankSuite, qaRewriteSuite } from './suites/qa-retrieval';
import { translationSuite } from './suites/translation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- suites differ in input, output and expected types
export type AnySuite = EvalSuite<any, any, any>;

export const SUITES: readonly AnySuite[] = [
  drawingTitleBlockSuite,
  qaRewriteSuite,
  qaRerankSuite,
  qaAnswerSuite,
  inductionDraftSuite,
  inductionAskSuite,
  translationSuite,
];
