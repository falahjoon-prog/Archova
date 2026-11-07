import type { StatusTone } from '@archova/ui';
import type { PlanStatus, StepStatus } from '../lib/types';

export const PLAN_TONE: Record<PlanStatus, StatusTone> = {
  active: 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

export const STEP_TONE: Record<StepStatus, StatusTone> = {
  open: 'warning',
  done: 'success',
  skipped: 'neutral',
};
