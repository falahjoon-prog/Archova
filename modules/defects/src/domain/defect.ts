// Defect rules that sit around the shared state machine (@archova/domain defects.ts): who sees a defect
// (DEF-AC9) and which side of a transition the caller is on. Pure rules, no IO.
import {
  defectTransition,
  type DefectAction,
  type DefectActor,
  type DefectStatus,
  type DefectTransitionResult,
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
}

/**
 * Builder staff see every defect. Everyone else sees defects assigned to their company, plus the ones they or
 * their company raised (a client's walk list). Drafts are the builder's, or their author's.
 */
export function canSeeDefect(d: DefectAudience, v: DefectViewer): boolean {
  if (v.isInternal) return true;
  const raised = d.createdBy === v.userId || (!!v.companyId && d.raisedByCompanyId === v.companyId);
  if (d.status === 'draft') return d.createdBy === v.userId;
  return raised || (!!v.companyId && d.assigneeCompanyId === v.companyId);
}

/**
 * The sides the caller can act as on this defect. Builder staff act as the builder; anyone in the assigned
 * company acts as the assignee (a builder's own crew can hold both).
 */
export function actorsFor(d: { assigneeCompanyId: string | null }, v: DefectViewer): DefectActor[] {
  const out: DefectActor[] = [];
  if (v.isInternal) out.push('builder');
  if (v.companyId && d.assigneeCompanyId === v.companyId) out.push('assignee');
  return out;
}

/** Runs the shared state machine for each side the caller can act as; the first that allows it wins. */
export function resolveTransition(
  d: { status: DefectStatus; assigneeCompanyId: string | null },
  v: DefectViewer,
  input: {
    action: DefectAction;
    reason?: string | null;
    photoCount?: number;
    requirePhotoForReady?: boolean;
  },
): DefectTransitionResult {
  const sides = actorsFor(d, v);
  let refusal: DefectTransitionResult = { ok: false, code: 'defect.not_allowed' };
  for (const actor of sides) {
    const r = defectTransition({ status: d.status, actor, ...input });
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
