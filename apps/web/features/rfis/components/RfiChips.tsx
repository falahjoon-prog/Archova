import { StatusPill, type StatusTone } from '@archova/ui';
import type { ProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { businessDaysBetween, formatLocalDate } from '@/shared/lib/format';
import { isOverdue } from '../lib/lifecycle';
import { STATUS_LABELS, type Rfi, type RfiStatus } from '../lib/types';

const TONES: Record<RfiStatus, StatusTone> = {
  draft: 'info',
  open: 'info',
  answered: 'warning',
  closed: 'success',
  void: 'neutral',
};

export function RfiStatusPill({ status }: { status: RfiStatus }) {
  return <StatusPill tone={TONES[status]}>{STATUS_LABELS[status]}</StatusPill>;
}

/** "Waiting on: Smith & Lowe Engineers · Jo Smith" (RFI-AC4). Names the signed-in person as "you". */
export function ballInCourtLabel(
  rfi: Pick<Rfi, 'ballInCourtId' | 'ballInCourtCompanyId'>,
  me: { id: string; name: string },
  dir: Pick<ProjectDirectory, 'personName' | 'companyName'>,
): string | null {
  if (!rfi.ballInCourtId && !rfi.ballInCourtCompanyId) return null;
  const person =
    rfi.ballInCourtId === me.id ? `${me.name} (you)` : dir.personName(rfi.ballInCourtId);
  return rfi.ballInCourtCompanyId
    ? `Waiting on: ${dir.companyName(rfi.ballInCourtCompanyId)} · ${person}`
    : `Waiting on: ${person}`;
}

/** Due date with the business-day count, and the danger chip once overdue (F1.4 states). */
export function RfiDue({ rfi, today }: { rfi: Pick<Rfi, 'status' | 'dueDate'>; today: string }) {
  if (!rfi.dueDate) return <span className="u-muted">No due date</span>;
  if (isOverdue(rfi, today)) {
    const late = -businessDaysBetween(today, rfi.dueDate);
    return (
      <StatusPill tone="danger">
        Overdue {late} business {late === 1 ? 'day' : 'days'} · {formatLocalDate(rfi.dueDate)}
      </StatusPill>
    );
  }
  if (rfi.status !== 'open') return <span>Due {formatLocalDate(rfi.dueDate)}</span>;
  const left = businessDaysBetween(today, rfi.dueDate);
  return (
    <span>
      Due {formatLocalDate(rfi.dueDate)}{' '}
      <span className="u-muted">
        ({left === 0 ? 'today' : `${left} business ${left === 1 ? 'day' : 'days'}`})
      </span>
    </span>
  );
}

export function ImpactChip({ rfi }: { rfi: Pick<Rfi, 'costImpact' | 'scheduleImpactDays'> }) {
  if (rfi.costImpact !== 'yes' && !rfi.scheduleImpactDays) return null;
  const parts = [
    rfi.costImpact === 'yes' ? 'Cost impact' : null,
    rfi.scheduleImpactDays ? `${rfi.scheduleImpactDays} days delay` : null,
  ].filter(Boolean);
  return <StatusPill tone="warning">{parts.join(' · ')}</StatusPill>;
}
