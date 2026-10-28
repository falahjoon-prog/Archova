// Defect lifecycle (product 06, backend schema/field.md). The API's `defects` module and the mobile app run this
// same state machine, so an action the phone allows offline is one the server accepts, and the reverse.
//
//   draft → open → ready_for_review → closed
//                ↖ (reject, reason) ↙
//   open → disputed (reason) → open (reassigned);  anything not closed → void (reason)

export const DEFECT_STATUSES = [
  'draft',
  'open',
  'ready_for_review',
  'closed',
  'disputed',
  'void',
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const DEFECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type DefectPriority = (typeof DEFECT_PRIORITIES)[number];

/** Contract milestone the defect is reported against (DEF-US7). */
export const DEFECT_STAGES = ['pre_pc', 'pc', 'dlp'] as const;
export type DefectStage = (typeof DEFECT_STAGES)[number];

export const DEFECT_ACTIONS = [
  /** Draft → open: assigned to a company and visible to it. */
  'issue',
  /** The subcontractor says it is fixed (DEF-AC5). */
  'markReadyForReview',
  /** The builder verifies the fix (DEF-AC6). */
  'close',
  /** The builder sends it back with a reason the subcontractor sees (DEF-AC6). */
  'reject',
  /** The subcontractor says it is not theirs. */
  'dispute',
  /** The builder assigns a disputed defect again. */
  'reassign',
  'void',
] as const;
export type DefectAction = (typeof DEFECT_ACTIONS)[number];

/** Who may take an action: the builder side, or the company the defect is assigned to. */
export type DefectActor = 'builder' | 'assignee';

interface Rule {
  from: readonly DefectStatus[];
  to: DefectStatus;
  actor: DefectActor;
  needsReason?: boolean;
}

const RULES: Record<DefectAction, Rule> = {
  issue: { from: ['draft'], to: 'open', actor: 'builder' },
  markReadyForReview: { from: ['open'], to: 'ready_for_review', actor: 'assignee' },
  close: { from: ['ready_for_review', 'open'], to: 'closed', actor: 'builder' },
  reject: { from: ['ready_for_review'], to: 'open', actor: 'builder', needsReason: true },
  dispute: { from: ['open'], to: 'disputed', actor: 'assignee', needsReason: true },
  reassign: { from: ['disputed'], to: 'open', actor: 'builder' },
  void: {
    from: ['draft', 'open', 'ready_for_review', 'disputed'],
    to: 'void',
    actor: 'builder',
    needsReason: true,
  },
};

export interface DefectTransitionInput {
  status: DefectStatus;
  action: DefectAction;
  actor: DefectActor;
  reason?: string | null;
  /** Photos attached to this transition (the "after" photo for ready for review). */
  photoCount?: number;
  /** Project setting: ready for review needs at least one photo (DEF-AC5, on by default). */
  requirePhotoForReady?: boolean;
}

export type DefectTransitionResult =
  | { ok: true; to: DefectStatus }
  | {
      ok: false;
      code:
        | 'defect.invalid_transition'
        | 'defect.not_allowed'
        | 'defect.reason_required'
        | 'defect.photo_required';
    };

export function defectTransition(input: DefectTransitionInput): DefectTransitionResult {
  const rule = RULES[input.action];
  if (!rule.from.includes(input.status)) return { ok: false, code: 'defect.invalid_transition' };
  if (rule.actor !== input.actor) return { ok: false, code: 'defect.not_allowed' };
  if (rule.needsReason && !input.reason?.trim())
    return { ok: false, code: 'defect.reason_required' };
  if (
    input.action === 'markReadyForReview' &&
    (input.requirePhotoForReady ?? true) &&
    (input.photoCount ?? 0) < 1
  ) {
    return { ok: false, code: 'defect.photo_required' };
  }
  return { ok: true, to: rule.to };
}

/** Actions an actor can offer on a defect in this status, for showing buttons. */
export function availableDefectActions(status: DefectStatus, actor: DefectActor): DefectAction[] {
  return DEFECT_ACTIONS.filter((a) => RULES[a].actor === actor && RULES[a].from.includes(status));
}

/** DEF-AC3: a defect needs a drawing pin or a location (or both). */
export function hasDefectLocation(defect: {
  locationId?: string | null;
  sheetId?: string | null;
  pinX?: number | null;
  pinY?: number | null;
}): boolean {
  const pinned =
    !!defect.sheetId &&
    typeof defect.pinX === 'number' &&
    typeof defect.pinY === 'number' &&
    defect.pinX >= 0 &&
    defect.pinX <= 1 &&
    defect.pinY >= 0 &&
    defect.pinY <= 1;
  return pinned || !!defect.locationId;
}

/** DEF-AC2: `DEF-0042` once the server has numbered it; offline drafts show a local label until then. */
export function defectLabel(number: number | null | undefined): string {
  return typeof number === 'number' && number > 0
    ? `DEF-${String(number).padStart(4, '0')}`
    : 'D-local';
}
