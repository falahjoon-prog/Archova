// Action plan lifecycle: a plan is active while any step is open, completes by itself when every step is done or
// skipped, and goes back to active if a step is reopened. A cancelled plan stays cancelled until someone reopens it.
// Pure, no IO.

export const ACTION_PLAN_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];
export const ACTION_ITEM_STATUSES = ['open', 'done', 'skipped'] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];
export const ACTION_PLAN_SOURCE_TYPES = ['observation', 'inspection'] as const;
export type ActionPlanSourceType = (typeof ACTION_PLAN_SOURCE_TYPES)[number];

export const actionPlanLabel = (n: number) => `AP-${String(n).padStart(4, '0')}`;

/** The status a plan should have given its steps. A cancelled plan is left alone. */
export function derivePlanStatus(
  current: ActionPlanStatus,
  items: readonly { status: ActionItemStatus }[],
): ActionPlanStatus {
  if (current === 'cancelled') return 'cancelled';
  if (items.length === 0) return 'active';
  return items.every((i) => i.status !== 'open') ? 'completed' : 'active';
}

export interface TemplateItem {
  title: string;
  description: string;
  dueOffsetDays: number | null;
}
