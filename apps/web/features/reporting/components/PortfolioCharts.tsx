'use client';

import Link from 'next/link';
import { Card, DonutChart, EmptyState, GroupedBars, SiteMap } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { formatMoney } from '@/shared/lib/format';
import type { Portfolio } from '../lib/types';
import { budgetGroups, mapPoints, phaseSlices } from '../lib/charts';

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

const SERIES = [
  { key: 'budget', label: 'Budget' },
  { key: 'forecast', label: 'Forecast final cost' },
  { key: 'spent', label: 'Spent so far' },
];

/** Phase ring, site map and budget bars for the projects on the portfolio. */
export function PortfolioCharts({ portfolio, orgSlug }: { portfolio: Portfolio; orgSlug: string }) {
  const projects = portfolio.projects;
  if (projects.length === 0) return null;
  const points = mapPoints(projects, orgSlug);
  const budgets = budgetGroups(projects, aud, (p) => (
    <Link className="link" href={webRoutes.project(orgSlug, p.id)}>
      {p.name}
    </Link>
  ));
  const noSite = projects.length - points.length;
  return (
    <div className="chart-grid">
      <Card title="Projects by phase">
        <DonutChart
          slices={phaseSlices(projects)}
          centreLabel="projects"
          ariaLabel="Number of projects in each phase"
        />
      </Card>
      <Card title="Project map">
        {points.length > 0 ? (
          <SiteMap points={points} linkAs={Link} ariaLabel="Map of project site locations" />
        ) : (
          <EmptyState
            title="No site locations yet"
            description="Set a site location on a project to see it on the map."
          />
        )}
        {points.length > 0 && noSite > 0 ? (
          <p className="u-muted">
            {noSite} {noSite === 1 ? 'project has' : 'projects have'} no site location set.
          </p>
        ) : null}
      </Card>
      <Card title="Budget, forecast and spent" className="chart-grid__wide">
        {budgets.length > 0 ? (
          <GroupedBars
            series={SERIES}
            groups={budgets}
            ariaLabel="Budget, forecast final cost and spent per project"
          />
        ) : (
          <EmptyState
            title="No budgets to show"
            description="Projects with a budget you can read appear here, largest forecast first."
          />
        )}
      </Card>
    </div>
  );
}
