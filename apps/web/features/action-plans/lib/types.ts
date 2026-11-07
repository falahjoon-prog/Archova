export type PlanStatus = 'active' | 'completed' | 'cancelled';
export type StepStatus = 'open' | 'done' | 'skipped';
export type SourceType = 'observation' | 'inspection';

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  open: 'Open',
  done: 'Done',
  skipped: 'Skipped',
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  observation: 'Observation',
  inspection: 'Inspection',
};

export interface ActionPlan {
  id: string;
  /** `AP-0007` */
  numberLabel: string;
  title: string;
  description: string;
  status: PlanStatus;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  isOverdue: boolean;
  templateId: string | null;
  sourceType: SourceType | null;
  sourceId: string | null;
  itemCount: number;
  /** Steps that are done or skipped. */
  doneCount: number;
  completedAt: string | null;
  createdAt: string;
  version: number;
}

export interface ActionStep {
  id: string;
  planId: string;
  sort: number;
  title: string;
  description: string;
  assigneeCompanyId: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  status: StepStatus;
  note: string | null;
  completedAt: string | null;
  canUpdate: boolean;
}

export interface ActionPlanDetail {
  plan: ActionPlan;
  items: ActionStep[];
  canManage: boolean;
}

export interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  items: { title: string; description: string; dueOffsetDays: number | null }[];
}

export interface StepInput {
  title: string;
  description?: string;
  assigneeCompanyId?: string;
  dueDate?: string;
}

export interface PlanInput {
  title: string;
  description?: string;
  dueDate?: string;
  templateId?: string;
  items?: StepInput[];
}

export interface PlanPatch {
  title?: string;
  description?: string;
  dueDate?: string | null;
  status?: 'active' | 'cancelled';
}

export interface StepPatch {
  title?: string;
  assigneeCompanyId?: string | null;
  dueDate?: string | null;
  status?: StepStatus;
  note?: string | null;
}

export interface PlanFilters {
  status?: PlanStatus;
}
