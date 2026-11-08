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
  /** Set when a stand-in acted for the final approver. */
  onBehalfOf: string | null;
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
  category: string | null;
  stage: DefectStage;
  locationId: string | null;
  /** The pin. From the API, `sheetId` is empty and `label` generic until screens look the sheet up by revision. */
  drawing: { sheetId: string; revisionId: string; label: string; x: number; y: number } | null;
  /** Null while a defect is a draft. */
  assigneeCompanyId: string | null;
  assigneeUserId: string | null;
  /** Everyone it is assigned to (people at the assigned company); `assigneeUserId` is the first. */
  assigneeUserIds: string[];
  /** Punch Item Manager. */
  managerUserId: string | null;
  /** Final Approver: when set, only they close, reject or reopen the item. */
  finalApproverUserId: string | null;
  /** Told about changes but not assigned. */
  distributionUserIds: string[];
  /** Stand-in who may close, reject and reopen in the approver's place between these dates. */
  approverDelegateUserId: string | null;
  approverDelegateFrom: string | null;
  approverDelegateUntil: string | null;
  /** Closing needs a note or a photo. */
  requireCloseEvidence: boolean;
  dueDate: string | null;
  raisedBy: string;
  raisedByCompanyId: string | null;
  source: 'manual' | 'inspection' | 'ai_suggested' | 'certifier';
  photos: DefectPhoto[];
  events: DefectEvent[];
  createdAt: string;
  readyForReviewAt: string | null;
  closedAt: string | null;
  /** What the caller can do now, from the API; null in preview, where `canDefect` decides from the status. */
  availableActions: readonly ApiDefectAction[] | null;
  /** The API's own overdue flag (project time zone); null in preview, which compares dates. */
  isOverdue: boolean | null;
  version: number;
}

/** The lifecycle actions as the API names them. */
export type ApiDefectAction =
  'issue' | 'markReadyForReview' | 'close' | 'reject' | 'dispute' | 'reassign' | 'void' | 'reopen';

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
  assigneeUserIds: string[];
  managerUserId: string | null;
  finalApproverUserId: string | null;
  distributionUserIds: string[];
  approverDelegateUserId: string | null;
  approverDelegateFrom: string | null;
  approverDelegateUntil: string | null;
  requireCloseEvidence: boolean;
  dueDate: string | null;
  category: string | null;
  /** Photos picked on the form; uploaded when the defect is saved. */
  photos: File[];
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

/** Nova's suggestion for a new defect. It fills the form once accepted; the person picks the assignee in live data. */
export interface DefectNovaSuggestion {
  /** The saved suggestion (`ais_`), passed back as `aiSuggestionId` when the defect is raised. */
  id: string;
  title: string;
  description: string | null;
  trade: string | null;
  category: string | null;
  priority: DefectPriority | null;
  /** Preview only: live Nova never picks the company. */
  companyId: string | null;
  gaps: string[];
  unsupportedNumbers: string[];
}
