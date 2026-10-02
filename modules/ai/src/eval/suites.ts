// Registered eval suites, one per Nova task (ai/06 §2). Each feature PR adds its suite here.
import type { EvalSuite } from './harness';
import { drawingTitleBlockSuite } from './suites/drawing-titleblock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- suites differ in input, output and expected types
export type AnySuite = EvalSuite<any, any, any>;

export const SUITES: readonly AnySuite[] = [drawingTitleBlockSuite];
