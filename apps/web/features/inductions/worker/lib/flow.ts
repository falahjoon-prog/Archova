import type { FlowStep, InductionProgress, WorkerInduction } from './types';

/** Steps counted in "Step x of y": details, each section, quiz, tickets and the declaration. */
export function totalSteps(induction: WorkerInduction): number {
  return induction.sectionCount + 4;
}

/** 1-based position of a step in "Step x of y"; welcome is 0 and done is past the end. */
export function stepNumber(step: FlowStep, induction: WorkerInduction): number {
  const n = induction.sectionCount;
  switch (step.kind) {
    case 'welcome':
      return 0;
    case 'details':
      return 1;
    case 'section':
      return 2 + step.index;
    case 'quiz':
      return 2 + n;
    case 'credentials':
      return 3 + n;
    case 'declaration':
      return 4 + n;
    case 'done':
      return 4 + n;
  }
}

/** Sections are in order; before the content is released there is nothing to have finished. */
function firstUnfinished(induction: WorkerInduction, p: InductionProgress): number {
  for (let i = 0; i < induction.sectionCount; i++) {
    const s = induction.sections[i];
    if (!s || !p.sections[s.id]?.complete) return i;
  }
  return -1;
}

/**
 * The furthest step the worker may be on, from saved progress: sections in order, then quiz, tickets and
 * declaration (IND-AC4). Reopening the link resumes here; nothing later is reachable.
 */
export function furthestStep(induction: WorkerInduction, p: InductionProgress): FlowStep {
  if (p.completion) return { kind: 'done' };
  if (!p.verified) return { kind: 'details' };
  const next = firstUnfinished(induction, p);
  if (next >= 0) return { kind: 'section', index: next };
  if (!p.quiz.passed) return { kind: 'quiz' };
  if (!p.credentials.some((c) => c.type === 'white_card')) return { kind: 'credentials' };
  return { kind: 'declaration' };
}

/** Whether `step` can be shown: anything up to the furthest step, so people can go back but not skip. */
export function isReachable(
  step: FlowStep,
  induction: WorkerInduction,
  p: InductionProgress,
): boolean {
  if (step.kind === 'welcome') return true;
  const furthest = furthestStep(induction, p);
  if (furthest.kind === 'done') return step.kind === 'done';
  if (step.kind === 'done') return false;
  return stepNumber(step, induction) <= stepNumber(furthest, induction);
}

/** URL form of a step (`?step=section&n=4`, 1-based like the screen) and back. */
export function stepToParams(step: FlowStep): { step: string | null; n: string | null } {
  if (step.kind === 'welcome') return { step: null, n: null };
  if (step.kind === 'section') return { step: 'section', n: String(step.index + 1) };
  return { step: step.kind, n: null };
}

export function paramsToStep(
  params: { step: string; n: string },
  induction: WorkerInduction,
): FlowStep | null {
  switch (params.step) {
    case '':
      return null;
    case 'section': {
      const i = Number(params.n) - 1;
      return Number.isInteger(i) && i >= 0 && i < induction.sectionCount
        ? { kind: 'section', index: i }
        : null;
    }
    case 'details':
    case 'quiz':
    case 'credentials':
    case 'declaration':
    case 'done':
      return { kind: params.step };
    default:
      return null;
  }
}

/** "About 20 minutes", or just the count when the length isn't known yet. */
export function aboutMinutes(m: number | null, sections: number): string {
  return m === null
    ? `${sections} short ${sections === 1 ? 'section' : 'sections'}`
    : `About ${Math.max(5, Math.round(m / 5) * 5)} minutes`;
}

/** 0412 345 678 → •••• ••• 678. */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return `•••• ••• ${digits.slice(-3)}`;
}

/** AU mobile: 04xx xxx xxx, or +61 4xx xxx xxx. */
export function isAuMobile(mobile: string): boolean {
  const d = mobile.replace(/[\s()-]/g, '');
  return /^(?:\+?61|0)4\d{8}$/.test(d);
}
