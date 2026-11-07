'use client';

import { useState } from 'react';
import { Card, EmptyState, Select, StatGrid, ToneBars } from '@archova/ui';
import { formatMoney } from '@/shared/lib/format';
import type { Portfolio } from '../lib/types';
import {
  costRollup,
  scheduleSummary,
  scopeProjects,
  statusBars,
  statusCount,
} from '../lib/statusReport';

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/** Cost rollup, budget-against-schedule counts and programme task status for all projects or one. */
export function StatusReport({ portfolio }: { portfolio: Portfolio }) {
  const [projectId, setProjectId] = useState('all');
  const projects = scopeProjects(portfolio.projects, projectId);
  if (portfolio.projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Projects you can see appear here with their cost and schedule status."
      />
    );
  }
  const cost = costRollup(projects);
  const counts = statusCount(projects);
  const sched = scheduleSummary(projects);
  const over = cost.overUnder.startsWith('-');
  return (
    <div className="stack-lg">
      <Select
        label="Project"
        value={projects.length === 1 ? (projects[0]?.id ?? 'all') : 'all'}
        onChange={(e) => setProjectId(e.target.value)}
        options={[
          { value: 'all', label: 'All projects' },
          ...portfolio.projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      {cost.projects > 0 ? (
        <StatGrid
          items={[
            { label: 'Revised budget', value: aud(cost.revised) },
            { label: 'Forecast final cost', value: aud(cost.forecastFinal) },
            { label: 'Spent so far', value: aud(cost.spent) },
            {
              label: 'Projected over/under',
              value: aud(over ? cost.overUnder.slice(1) : cost.overUnder),
              tone: over ? 'danger' : 'success',
              hint: over ? 'over budget' : 'under budget',
            },
            { label: 'Forecast as % of budget', value: pct(cost.forecastOfBudgetPct) },
            { label: 'Spent as % of forecast', value: pct(cost.spentOfForecastPct) },
          ]}
        />
      ) : (
        <EmptyState
          title="No budget to roll up"
          description="Projects with a budget you can read appear here."
        />
      )}
      <div className="chart-grid">
        <Card title="Project count by status">
          <ToneBars bars={statusBars(counts)} ariaLabel="Projects by budget and schedule status" />
          <p className="u-muted">Off schedule means at least one programme activity is late.</p>
        </Card>
        <Card title="Schedule tasks by status">
          {sched.projects > 0 ? (
            <div className="stack">
              <ToneBars
                bars={[
                  { label: 'Not started', value: sched.notStarted, tone: 'neutral' },
                  { label: 'In progress', value: sched.inProgress, tone: 'info' },
                  { label: 'Completed', value: sched.completed, tone: 'success' },
                ]}
                ariaLabel="Programme activities by status"
              />
              <StatGrid
                items={[
                  {
                    label: 'Late tasks',
                    value: sched.late,
                    tone: sched.late > 0 ? 'danger' : undefined,
                  },
                  {
                    label: 'Average days late',
                    value: sched.averageDaysLate === null ? '—' : sched.averageDaysLate,
                  },
                ]}
              />
            </div>
          ) : (
            <EmptyState
              title="No programme to show"
              description="You cannot read the programme on these projects."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
