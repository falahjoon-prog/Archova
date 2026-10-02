// `defects.defects` and `defects.events` (backend schema/field.md) as the web app uses them. Replaced by
// `@archova/contracts` types when the defects endpoints land.

export const DEFECT_STATUSES = [
  'draft',
  'open',
  'ready_for_review',
  'closed',
  'disputed',
  'void',
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];
export type DefectStage = 'pre_pc' | 'pc' | 'dlp';
export type DefectPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DefectPhoto {
  id: string;
  name: string;
  /** before = raised with the defect; after = fix evidence; closeout = builder's evidence. */
  kind: 'before' | 'after' | 'closeout';
}

export interface DefectEvent {
  id: string;
  fromStatus: DefectStatus | null;
  toStatus: DefectStatus;
  note: string | null;
  photoIds: string[];
  by: string;
  at: string;
}

export interface Defect {
  id: string;
  /** DEF-0001 per project; issued on first sync, so offline drafts have none (DEF-AC2). */
  number: number | null;
  title: string;
  description: string;
  status: DefectStatus;
  priority: DefectPriority;
  trade: string;
  stage: DefectStage;
  locationId: string | null;
  drawing: { sheetId: string; revisionId: string; label: string; x: number; y: number } | null;
  assigneeCompanyId: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  raisedBy: string;
  raisedByCompanyId: string | null;
  source: 'manual' | 'inspection' | 'ai_suggested' | 'certifier';
  photos: DefectPhoto[];
  events: DefectEvent[];
  createdAt: string;
  readyForReviewAt: string | null;
  closedAt: string | null;
}

export interface DefectInput {
  title: string;
  description: string;
  priority: DefectPriority;
  trade: string;
  stage: DefectStage;
  locationId: string | null;
  drawing: Defect['drawing'];
  assigneeCompanyId: string | null;
  assigneeUserId: string | null;
  dueDate: string | null;
  photoNames: string[];
}

export const STATUS_LABELS: Record<DefectStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  ready_for_review: 'Ready for inspection',
  closed: 'Closed',
  disputed: 'Disputed',
  void: 'Void',
};

export const STAGE_LABELS: Record<DefectStage, string> = {
  pre_pc: 'Pre-PC',
  pc: 'PC',
  dlp: 'DLP',
};

export const PRIORITY_LABELS: Record<DefectPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const formatDefectNumber = (n: number | null) =>
  n === null ? 'D-local' : `DEF-${String(n).padStart(4, '0')}`;
