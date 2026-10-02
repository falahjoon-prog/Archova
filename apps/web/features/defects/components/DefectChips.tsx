import { StatusPill, type StatusTone } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import { isDefectOverdue } from '../lib/lifecycle';
import {
  STAGE_LABELS,
  STATUS_LABELS,
  type Defect,
  type DefectStage,
  type DefectStatus,
} from '../lib/types';

const TONES: Record<DefectStatus, StatusTone> = {
  draft: 'info',
  open: 'info',
  ready_for_review: 'warning',
  closed: 'success',
  disputed: 'danger',
  void: 'neutral',
};

export function DefectStatusPill({ status }: { status: DefectStatus }) {
  return <StatusPill tone={TONES[status]}>{STATUS_LABELS[status]}</StatusPill>;
}

export function StageBadge({ stage }: { stage: DefectStage }) {
  return <StatusPill tone="neutral">{STAGE_LABELS[stage]}</StatusPill>;
}

export function DefectDue({
  defect,
  today,
}: {
  defect: Pick<Defect, 'status' | 'dueDate'>;
  today: string;
}) {
  if (!defect.dueDate) return <span className="u-muted">No due date</span>;
  if (isDefectOverdue(defect, today)) {
    return <StatusPill tone="danger">Overdue · {formatLocalDate(defect.dueDate)}</StatusPill>;
  }
  return <span>{formatLocalDate(defect.dueDate)}</span>;
}
