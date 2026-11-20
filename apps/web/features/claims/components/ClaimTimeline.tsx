import { DataTable, StatusPill, type DataTableColumn, type StatusTone } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import type { PaymentClaimDetail } from '../data/api';

type Step = PaymentClaimDetail['timeline'][number];

const LABEL: Record<Step['status'], string> = {
  done: 'Done',
  upcoming: 'Upcoming',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  closed: 'Window closed',
};
const TONE: Record<Step['status'], StatusTone> = {
  done: 'success',
  upcoming: 'neutral',
  due_soon: 'warning',
  overdue: 'danger',
  closed: 'neutral',
};

/** The claim's path from service to payment, plus the adjudication windows that apply now. Words and tone, never colour alone. */
export function ClaimTimeline({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  const columns: DataTableColumn<Step>[] = [
    {
      id: 'step',
      header: 'Step',
      rowHeader: true,
      cell: (s) => (
        <>
          {s.label}
          {s.note ? <div className="u-muted">{s.note}</div> : null}
        </>
      ),
    },
    {
      id: 'date',
      header: 'Date',
      cell: (s) => formatLocalDate((s.doneOn ?? s.dueOn)!),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusPill tone={TONE[s.status]}>{LABEL[s.status]}</StatusPill>,
    },
  ];
  return (
    <DataTable
      caption="Timeline: claim, schedule, payment and adjudication"
      columns={columns}
      rows={steps}
      getRowId={(s) => s.key}
    />
  );
}
