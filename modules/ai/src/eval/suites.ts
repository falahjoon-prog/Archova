// Registered eval suites, one per Nova task (ai/06 §2). Each feature PR adds its suite here.
import type { EvalSuite } from './harness';
import { drawingTitleBlockSuite } from './suites/drawing-titleblock';
import { inductionDraftSuite } from './suites/induction-draft';
import { qaAnswerSuite } from './suites/qa-answer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- suites differ in input, output and expected types
export type AnySuite = EvalSuite<any, any, any>;

export const SUITES: readonly AnySuite[] = [
  drawingTitleBlockSuite,
  qaAnswerSuite,
  inductionDraftSuite,
];
