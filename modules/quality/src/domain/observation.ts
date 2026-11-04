// Observation lifecycle: open → resolved (by the assigned company or the builder) → closed (builder admin).
// A resolved observation the builder isn't happy with is reopened. Pure, no IO.

export const OBSERVATION_TYPES = ['safety', 'quality', 'environmental', 'commercial'] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];
export const OBSERVATION_STATUSES = ['open', 'resolved', 'closed'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export const OBSERVATION_ACTIONS = ['resolve', 'close', 'reopen', 'stopWork'] as const;
export type ObservationAction = (typeof OBSERVATION_ACTIONS)[number];

export interface ObservationViewer {
  userId: string;
  companyId: string | null;
  isInternal: boolean;
}

export interface ObservationAudience {
  assigneeCompanyId: string | null;
  raisedByCompanyId: string | null;
  createdBy: string | null;
}

/** Builder staff see all. Others see observations assigned to their company or raised by them or their company. */
export function canSeeObservation(o: ObservationAudience, v: ObservationViewer): boolean {
  if (v.isInternal) return true;
  if (o.createdBy === v.userId) return true;
  if (!v.companyId) return false;
  return o.assigneeCompanyId === v.companyId || o.raisedByCompanyId === v.companyId;
}

export type ObservationTransition =
  | { ok: true; to: ObservationStatus }
  | { ok: false; code: 'observation.invalid_transition' | 'observation.reason_required' };

/** `stopWork` is the r300 action: a safety observation that the SWMS isn't being followed. It keeps the observation open. */
export function observationTransition(
  from: ObservationStatus,
  action: ObservationAction,
  reason: string | null,
): ObservationTransition {
  const to: ObservationStatus | null =
    action === 'resolve' && from === 'open'
      ? 'resolved'
      : action === 'close' && (from === 'open' || from === 'resolved')
        ? 'closed'
        : action === 'reopen' && (from === 'resolved' || from === 'closed')
          ? 'open'
          : action === 'stopWork' && from === 'open'
            ? 'open'
            : null;
  if (!to) return { ok: false, code: 'observation.invalid_transition' };
  if ((action === 'reopen' || action === 'stopWork') && !reason?.trim())
    return { ok: false, code: 'observation.reason_required' };
  return { ok: true, to };
}

export const observationLabel = (n: number) => `OBS-${String(n).padStart(4, '0')}`;

/** Actions the caller can take now: the state machine, which side they are on, and their permission level. */
export function availableObservationActions(
  o: ObservationAudience & {
    status: ObservationStatus;
    type: ObservationType;
    swmsId: string | null;
  },
  v: ObservationViewer,
  caps: { create: boolean; close: boolean },
): ObservationAction[] {
  const assigned = v.companyId !== null && o.assigneeCompanyId === v.companyId;
  return OBSERVATION_ACTIONS.filter((a) => {
    if (!observationTransition(o.status, a, 'x').ok) return false;
    if (a === 'close' || a === 'reopen') return caps.close;
    if (!caps.create) return false;
    if (a === 'resolve') return v.isInternal || assigned;
    if (a === 'stopWork') return o.type === 'safety';
    return true;
  });
}
