'use client';

import {
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { SwmsIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useScorecards } from '../hooks/useScorecards';
import type { Scorecard } from '../data/api';

const RATING: Record<Scorecard['rating'], { tone: StatusTone; label: string }> = {
  good: { tone: 'success', label: 'Good' },
  watch: { tone: 'info', label: 'Watch' },
  elevated: { tone: 'warning', label: 'Elevated risk' },
  high: { tone: 'danger', label: 'High risk' },
};
const TREND: Record<Scorecard['trend'], string> = {
  improving: 'Improving',
  steady: 'Steady',
  worsening: 'Getting worse',
};

const columns: DataTableColumn<Scorecard>[] = [
  {
    id: 'company',
    header: 'Company',
    rowHeader: true,
    sortValue: (c) => c.name,
    cell: (c) => c.name,
  },
  { id: 'score', header: 'Score', sortValue: (c) => c.score, cell: (c) => `${c.score} / 100` },
  {
    id: 'rating',
    header: 'Rating',
    cell: (c) => <StatusPill tone={RATING[c.rating].tone}>{RATING[c.rating].label}</StatusPill>,
  },
  { id: 'trend', header: 'Last 90 days', cell: (c) => TREND[c.trend] },
  {
    id: 'incidents',
    header: 'Incidents (12 mo)',
    sortValue: (c) => c.counts.incidents12m,
    cell: (c) => String(c.counts.incidents12m),
  },
  {
    id: 'actions',
    header: 'Overdue actions',
    sortValue: (c) => c.counts.overdueActions,
    cell: (c) => String(c.counts.overdueActions),
  },
  {
    id: 'why',
    header: 'Why',
    cell: (c) =>
      c.flags.length ? (
        <details>
          <summary>{c.flags[0]}</summary>
          <ul className="u-m-0">
            {c.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
            {c.components
              .filter((x) => x.lost > 0)
              .map((x) => (
                <li key={x.key} className="u-muted">
                  {x.label}: -{x.lost} of {x.max} ({x.detail})
                </li>
              ))}
          </ul>
        </details>
      ) : (
        <span className="u-muted">Nothing to flag</span>
      ),
  },
];

/** Subcontractor safety scorecards for the companies on this project. Builder staff only. */
export function SafetyScorecardsScreen() {
  const q = useScorecards();
  const flagged = (q.data ?? []).filter((c) => c.riskFlag);
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Safety scorecards"
        description="How each company on this project has performed on safety across all your projects: incidents, overdue corrective actions, SWMS, site induction at sign-on and safety observations. A prompt to look before you re-engage a sub, not a verdict."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Safety scorecards" /> : null}
      <div className="stack">
        <ErrorAlert error={q.error} title="We couldn't load safety scorecards" />
        {flagged.length ? (
          <section aria-label="Nova flags" className="stack">
            <h2 className="u-m-0">Nova suggests a closer look</h2>
            <ul className="u-m-0">
              {flagged.map((c) => (
                <li key={c.companyId}>{c.riskFlag}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {q.isPending ? (
          <SkeletonRows label="Loading safety scorecards…" />
        ) : q.data && q.data.length === 0 ? (
          <EmptyState
            icon={SwmsIcon}
            title="No companies on this project yet"
            description="Once companies are added, their safety record shows here."
          />
        ) : q.data ? (
          <DataTable
            caption="Safety scorecards"
            columns={columns}
            rows={q.data}
            getRowId={(c) => c.companyId}
          />
        ) : null}
      </div>
    </>
  );
}
