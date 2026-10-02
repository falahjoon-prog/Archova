// RFI lifecycle (product/03 "Lifecycle", schema rfis): draft → open → answered → closed; open|answered → void;
// closed → open (reopen). Pure rules, no IO.

export const RFI_STATUSES = ['draft', 'open', 'answered', 'closed', 'void'] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export type RfiAction = 'open' | 'answer' | 'close' | 'reopen' | 'void' | 'edit';

const ALLOWED: Record<RfiAction, readonly RfiStatus[]> = {
  open: ['draft'],
  answer: ['open', 'answered'],
  close: ['answered'],
  reopen: ['closed'],
  void: ['open', 'answered'],
  edit: ['draft', 'open', 'answered'],
};

const NEXT: Partial<Record<RfiAction, RfiStatus>> = {
  open: 'open',
  answer: 'answered',
  close: 'closed',
  reopen: 'open',
  void: 'void',
};

export function canTransition(from: RfiStatus, action: RfiAction): boolean {
  return ALLOWED[action].includes(from);
}

/** The status after `action`, or null when the action isn't allowed from `from`. */
export function nextStatus(from: RfiStatus, action: RfiAction): RfiStatus | null {
  if (!canTransition(from, action)) return null;
  return NEXT[action] ?? from;
}

/** What an RFI needs before it can be sent (RFI-AC2). Returns the missing fields. */
export function missingToOpen(r: {
  subject: string;
  questionText: string;
  assigneeCount: number;
  dueDate: string | null;
}): string[] {
  const missing: string[] = [];
  if (!r.subject.trim()) missing.push('subject');
  if (!r.questionText.trim()) missing.push('question');
  if (r.assigneeCount === 0) missing.push('assigneeIds');
  if (!r.dueDate) missing.push('dueDate');
  return missing;
}

/** Whose court the ball is in (RFI-AC4): the assignees while open, the builder's RFI manager once answered. */
export function ballInCourt(
  status: RfiStatus,
  r: { managerId: string | null; assigneeIds: readonly string[] },
): { side: 'assignees' | 'builder' | null; userIds: string[] } {
  if (status === 'open') return { side: 'assignees', userIds: [...r.assigneeIds] };
  if (status === 'answered') return { side: 'builder', userIds: r.managerId ? [r.managerId] : [] };
  return { side: null, userIds: [] };
}

export interface RfiAudience {
  status: RfiStatus;
  isPrivate: boolean;
  createdBy: string | null;
  raisedByCompanyId: string | null;
  distributionUserIds: readonly string[];
  distributionCompanyIds: readonly string[];
  assigneeUserIds: readonly string[];
  assigneeCompanyIds: readonly string[];
}

export interface RfiViewer {
  userId: string;
  companyId: string | null;
  /** Builder staff (org members) see every RFI on the project. */
  isInternal: boolean;
}

/**
 * RFI-AC9 and RFI-US12. Builder staff see everything. Subcontractors and consultants see RFIs their company
 * raised, RFIs assigned or distributed to them or their company, and never private ones. Drafts stay with
 * the company that wrote them until the builder sends them.
 */
export function canSeeRfi(r: RfiAudience, v: RfiViewer): boolean {
  if (v.isInternal) return true;
  const ownCompany = v.companyId !== null && r.raisedByCompanyId === v.companyId;
  if (r.status === 'draft') return r.createdBy === v.userId || ownCompany;
  if (r.isPrivate) return false;
  if (ownCompany || r.createdBy === v.userId) return true;
  if (r.assigneeUserIds.includes(v.userId) || r.distributionUserIds.includes(v.userId)) return true;
  return (
    v.companyId !== null &&
    (r.distributionCompanyIds.includes(v.companyId) || r.assigneeCompanyIds.includes(v.companyId))
  );
}

/** "RFI-007" (RFI-AC1). */
export const formatRfiNumber = (n: number) => `RFI-${String(n).padStart(3, '0')}`;
