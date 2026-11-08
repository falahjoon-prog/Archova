// Defect rules that sit around the shared state machine (@archova/domain defects.ts): who sees a defect
// (DEF-AC9) and which side of a transition the caller is on. Pure rules, no IO.
import {
  defectTransition,
  type DefectAction,
  type DefectActor,
  type DefectStatus,
  type DefectTransitionResult,
  defectApproverRule,
  isActiveDelegate,
} from '@archova/domain';

export interface DefectViewer {
  userId: string;
  companyId: string | null;
  /** Builder staff (a member of the organisation), as opposed to subcontractors, consultants and clients. */
  isInternal: boolean;
}

export interface DefectAudience {
  status: DefectStatus;
  assigneeCompanyId: string | null;
  raisedByCompanyId: string | null;
  createdBy: string | null;
  /** People named on the punch item; each sees it whatever their company (their copy of the walk list). */
  managerUserId?: string | null;
  finalApproverUserId?: string | null;
  approverDelegateUserId?: string | null;
  assigneeUserIds?: readonly string[];
  distributionUserIds?: readonly string[];
}

/** True when the person is named on the defect as manager, final approver, assignee or distribution member. */
export function isNamedOn(d: DefectAudience, userId: string): boolean {
  return (
    d.managerUserId === userId ||
    d.finalApproverUserId === userId ||
    d.approverDelegateUserId === userId ||
    !!d.assigneeUserIds?.includes(userId) ||
    !!d.distributionUserIds?.includes(userId)
  );
}

/**
 * Builder staff see every defect. Everyone else sees defects assigned to their company, plus the ones they or
 * their company raised (a client's walk list). Drafts are the builder's, or their author's.
 */
export function canSeeDefect(d: DefectAudience, v: DefectViewer): boolean {
  if (v.isInternal) return true;
  const raised = d.createdBy === v.userId || (!!v.companyId && d.raisedByCompanyId === v.companyId);
  if (d.status === 'draft') return d.createdBy === v.userId;
  return raised || isNamedOn(d, v.userId) || (!!v.companyId && d.assigneeCompanyId === v.companyId);
}

/**
 * The sides the caller can act as on this defect. Builder staff act as the builder; anyone in the assigned
 * company acts as the assignee (a builder's own crew can hold both).
 */
export function actorsFor(
  d: {
    assigneeCompanyId: string | null;
    finalApproverUserId?: string | null;
    approverDelegateUserId?: string | null;
    approverDelegateFrom?: string | null;
    approverDelegateUntil?: string | null;
  },
  v: DefectViewer,
  today?: string | null,
): DefectActor[] {
  const out: DefectActor[] = [];
  // The named final approver holds the builder's side even when they are a client or consultant.
  if (v.isInternal || d.finalApproverUserId === v.userId || isActiveDelegate(d, v.userId, today))
    out.push('builder');
  if (v.companyId && d.assigneeCompanyId === v.companyId) out.push('assignee');
  return out;
}

/** Runs the shared state machine for each side the caller can act as; the first that allows it wins. */
export function resolveTransition(
  d: {
    status: DefectStatus;
    assigneeCompanyId: string | null;
    finalApproverUserId?: string | null;
    approverDelegateUserId?: string | null;
    approverDelegateFrom?: string | null;
    approverDelegateUntil?: string | null;
    requireCloseEvidence?: boolean;
  },
  v: DefectViewer,
  input: {
    action: DefectAction;
    reason?: string | null;
    photoCount?: number;
    requirePhotoForReady?: boolean;
  },
  /** The project-local date, for stand-in dates. */
  today: string | null = null,
): DefectTransitionResult {
  // With a final approver named, only they close, reject or reopen (the state machine still has the last word).
  if (!defectApproverRule(d, input.action, v.userId, today))
    return { ok: false, code: 'defect.not_allowed' };
  const sides = actorsFor(d, v, today);
  let refusal: DefectTransitionResult = { ok: false, code: 'defect.not_allowed' };
  for (const actor of sides) {
    const r = defectTransition({
      status: d.status,
      actor,
      ...(d.requireCloseEvidence ? { requireCloseEvidence: true } : {}),
      ...input,
    });
    if (r.ok) return r;
    // A wrong-side refusal on one side should not hide a more useful reason from the other.
    if (r.code !== 'defect.not_allowed') refusal = r;
  }
  return refusal;
}

/** The permission a transition needs on top of the state machine (DEF-AC6: closing needs Defects admin). */
export function permissionFor(action: DefectAction) {
  switch (action) {
    case 'issue':
      return 'defects.defects.create' as const;
    case 'markReadyForReview':
    case 'dispute':
      return 'defects.defects.respond' as const;
    default:
      return 'defects.defects.close' as const;
  }
}
