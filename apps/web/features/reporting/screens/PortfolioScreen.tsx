'use client';

import { useState } from 'react';
import { Alert, Checkbox, PageHeader, SkeletonRows, Tabs } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useBranding, useSaveBranding } from '@/features/branding';
import { DashboardEditor, type Tile, type TileContext } from '@/features/dashboard';
import { StatusReport } from '../components/StatusReport';
import { usePortfolio } from '../hooks/useReporting';
import { SAMPLE_PORTFOLIO } from '../tiles';

/** The layout a company gets until it edits one: the widgets it switched on in Settings → Branding, four to a row. */
function defaultLayout(widgets: readonly string[]): Tile[] {
  const tiles: Tile[] = [];
  let col = 0;
  let row = 0;
  for (const key of widgets) {
    if (key === 'project_table') continue;
    if (col + 3 > 12) {
      col = 0;
      row += 2;
    }
    tiles.push({ id: key, type: `stat_${key}`, x: col, y: row, w: 3, h: 2 });
    col += 3;
  }
  tiles.push({
    id: 'charts',
    type: 'portfolio_charts',
    x: 0,
    y: tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0),
    w: 12,
    h: 7,
  });
  if (widgets.includes('project_table')) {
    const y = tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);
    tiles.push({ id: 'project_table', type: 'projects_table', x: 0, y, w: 12, h: 8 });
  }
  return tiles;
}

const DEFAULT_WIDGETS = [
  'projects',
  'rfis',
  'defects',
  'submittals',
  'claims',
  'variations',
  'incidents',
  'programme',
  'budget',
  'project_table',
];

/** Every project in the company at a glance, as a board of tiles the company can rearrange, resize and add to. */
export function PortfolioScreen() {
  const org = useCurrentOrg();
  const [includeClosed, setIncludeClosed] = useState(false);
  const [view, setView] = useState('overview');
  const portfolio = usePortfolio(includeClosed);
  const branding = useBranding().data;
  const save = useSaveBranding();
  const tiles =
    branding?.dashboardLayout ?? defaultLayout(branding?.dashboardWidgets ?? DEFAULT_WIDGETS);
  const ctx: TileContext = {
    surface: 'portfolio',
    orgId: org.orgId,
    orgSlug: org.orgSlug,
    data: portfolio.data,
  };
  const sampleCtx: TileContext = { ...ctx, data: SAMPLE_PORTFOLIO, preview: true };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Portfolio"
        description="Open items on every project you can see, with what is overdue in red. Counts only include what you are allowed to open on each project."
      />
      <ErrorAlert error={portfolio.error} title="We couldn't load the portfolio" />
      {portfolio.data?.truncated ? (
        <Alert tone="info" title="Showing the first 200 projects">
          Close out finished projects to bring the rest into view.
        </Alert>
      ) : null}
      <Tabs
        label="Portfolio views"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'status', label: 'Status report' },
        ]}
        value={view}
        onValueChange={setView}
      >
        {view === 'status' ? (
          portfolio.data ? (
            <StatusReport portfolio={portfolio.data} />
          ) : (
            <SkeletonRows label="Loading the status report…" />
          )
        ) : (
          <DashboardEditor
            surface="portfolio"
            tiles={tiles}
            ctx={ctx}
            sampleCtx={sampleCtx}
            canEdit={(org.role === 'owner' || org.role === 'admin') && !!branding}
            saving={save.isPending}
            error={save.error}
            onSave={(next) => save.mutateAsync({ patch: { dashboardLayout: next } })}
            onReset={() => save.mutateAsync({ patch: { dashboardLayout: null } })}
            toolbarExtra={
              <Checkbox
                label="Include closed and archived projects"
                checked={includeClosed}
                onChange={(e) => setIncludeClosed(e.target.checked)}
              />
            }
          />
        )}
      </Tabs>
    </div>
  );
}
