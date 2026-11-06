// Pure rules of an approval chain. No database, no clock.

export interface StepDef {
  name: string;
  /** Any one of these people clears the step. */
  approverUserIds: string[];
}

export const MAX_STEPS = 8;
export const MAX_APPROVERS = 10;

export interface Problem {
  path: string;
  message: string;
}

/** Checks the shape of a chain and returns cleaned steps, or what is wrong with them. */
export function checkSteps(
  input: readonly { name: string; approverUserIds: readonly string[] }[],
): { steps: StepDef[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const steps: StepDef[] = [];
  if (input.length < 1 || input.length > MAX_STEPS)
    problems.push({ path: 'steps', message: `Give between 1 and ${MAX_STEPS} steps` });
  input.forEach((s, i) => {
    const name = s.name.trim();
    const ids = [...new Set(s.approverUserIds)];
    if (!name || name.length > 100)
      problems.push({ path: `steps/${i}/name`, message: 'Name the step (up to 100 characters)' });
    if (ids.length < 1 || ids.length > MAX_APPROVERS)
      problems.push({
        path: `steps/${i}/approverUserIds`,
        message: `Name between 1 and ${MAX_APPROVERS} approvers`,
      });
    steps.push({ name, approverUserIds: ids });
  });
  // Nobody may decide two steps of one run, so one person who is the only approver of two steps would stall it.
  const sole = new Map<string, number>();
  steps.forEach((s, i) => {
    if (s.approverUserIds.length !== 1) return;
    const only = s.approverUserIds[0]!;
    if (sole.has(only))
      problems.push({
        path: `steps/${i}/approverUserIds`,
        message: `That person is already the only approver of step ${sole.get(only)! + 1}. Add a second approver to one of the steps`,
      });
    else sole.set(only, i);
  });
  return { steps, problems };
}

/** Whether a chain applies to a record worth `amountCents`. */
export function applies(def: { minAmountCents: number | null }, amountCents: number): boolean {
  return def.minAmountCents === null || amountCents >= def.minAmountCents;
}

/** True when every step has someone other than the person starting the run who could clear it. */
export function everyStepHasApprover(steps: readonly StepDef[], starter: string): boolean {
  return steps.every((s) => s.approverUserIds.some((u) => u !== starter));
}

export type DecisionRefusal = 'not_approver' | 'own_submission' | 'already_decided_earlier';

/**
 * Who may decide the current step: a named approver, not the person who started the run, and not someone who already
 * cleared an earlier step.
 */
export function refusal(
  step: StepDef,
  userId: string,
  starter: string,
  earlierDeciders: readonly string[],
): DecisionRefusal | null {
  if (userId === starter) return 'own_submission';
  if (!step.approverUserIds.includes(userId)) return 'not_approver';
  if (earlierDeciders.includes(userId)) return 'already_decided_earlier';
  return null;
}

export type Outcome = 'advanced' | 'approved' | 'rejected';

/** What a decision on step `index` of `total` does to the run. A rejection ends it; the last approval completes it. */
export function nextState(
  index: number,
  total: number,
  decision: 'approved' | 'rejected',
): { outcome: Outcome; currentStep: number | null } {
  if (decision === 'rejected') return { outcome: 'rejected', currentStep: null };
  if (index + 1 >= total) return { outcome: 'approved', currentStep: null };
  return { outcome: 'advanced', currentStep: index + 1 };
}

const DECIMAL = /^\d{1,16}(\.\d{1,2})?$/;

/** Decimal dollars ("1500.50") to whole cents. */
export function toCents(value: string): number {
  if (!DECIMAL.test(value)) throw new RangeError(`Invalid money: ${value}`);
  const [whole, frac = ''] = value.split('.') as [string, string?];
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
