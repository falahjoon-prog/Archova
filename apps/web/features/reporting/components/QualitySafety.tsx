'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  SegmentBar,
  Select,
  StatGrid,
  ToneBars,
} from '@archova/ui';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { PHASE_LABELS } from '../lib/charts';
import type { Portfolio } from '../lib/types';
import {
  ALL_FILTERS,
  filterProjects,
  flags,
  kpis,
  leaderboard,
  projectStates,
  regionStreaks,
  splitRows,
  streaks,
  type QsFilters,
  type SplitRow,
} from '../lib/qualitySafety';

const DISMISSED = 'archova.qs-dismissed-flags';

// Dismissing a flag is a per-person convenience kept in this browser; the page works without it.
function loadDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(DISMISSED, JSON.stringify(keys));
  } catch {
    /* storage can be blocked; the dismissal then lasts until the page closes */
  }
}

const days = (n: number | null) =>
  n === null ? 'None recorded' : `${n} ${n === 1 ? 'day' : 'days'}`;

function SplitCard({ title, rows, orgSlug }: { title: string; rows: SplitRow[]; orgSlug: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="u-muted">Nothing open on the projects you can read.</p>
      ) : (
        <ul className="qs-split" aria-label={title}>
          {rows.map((r) => (
            <li key={r.id} className="qs-split__row">
              <Link className="link qs-split__name" href={webRoutes.project(orgSlug, r.id)}>
                {r.name}
              </Link>
              <SegmentBar
                max={max}
                segments={[
                  { label: 'Overdue', value: r.overdue, tone: 'danger' },
                  { label: 'Next 7 days', value: r.next7, tone: 'warning' },
                  { label: 'Later', value: r.later, tone: 'neutral' },
                ]}
              />
              <span className="qs-split__nums">
                {r.overdue} overdue · {r.next7} next 7 days · {r.later} later
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Portfolio quality and safety: counts, safety streaks by region, a project leaderboard and rule-based flags. */
export function QualitySafety({ portfolio }: { portfolio: Portfolio }) {
  const org = useCurrentOrg();
  const [filters, setFilters] = useState<QsFilters>(ALL_FILTERS);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(loadDismissed()), []);

  if (portfolio.projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Quality and safety figures appear here for the projects you can see."
      />
    );
  }
  const projects = filterProjects(portfolio.projects, filters);
  const k = kpis(projects);
  const list = streaks(projects);
  const regions = regionStreaks(list);
  const board = leaderboard(list);
  const activeFlags = flags(projects).filter((f) => !dismissed.includes(f.key));
  const states = projectStates(portfolio.projects);
  const phases = [...new Set(portfolio.projects.map((p) => p.phase).filter((x) => !!x))];
  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    saveDismissed(next);
  };
  const overall = regionStreaks(list.map((s) => ({ ...s, region: 'All shown' })))[0];
  const incidentBars = projects
    .filter((p) => !p.incidents.restricted && p.incidents.last12Months > 0)
    .sort((a, b) => b.incidents.last12Months - a.incidents.last12Months)
    .slice(0, 8)
    .map((p) => ({
      label: p.name,
      value: p.incidents.last12Months,
      tone: p.incidents.last12Months >= 3 ? ('danger' as const) : ('info' as const),
    }));

  return (
    <div className="stack-lg">
      <div className="chart-grid">
        <Select
          label="Region"
          value={filters.state}
          onChange={(e) => setFilters({ ...filters, state: e.target.value })}
          options={[
            { value: 'all', label: 'All regions' },
            ...states.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Select
          label="Phase"
          value={filters.phase}
          onChange={(e) => setFilters({ ...filters, phase: e.target.value })}
          options={[
            { value: 'all', label: 'All phases' },
            ...phases.map((p) => ({
              value: p as string,
              label: PHASE_LABELS[p as string] ?? String(p),
            })),
          ]}
        />
      </div>
      {projects.length === 0 ? (
        <EmptyState title="No projects match" description="Change the region or phase." />
      ) : (
        <>
          {activeFlags.length > 0 ? (
            <div className="stack" aria-label="Flags">
              {activeFlags.map((f) => (
                <Alert
                  key={f.key}
                  tone="warning"
                  title="Worth a look"
                  action={
                    <Button variant="secondary" onClick={() => dismiss(f.key)}>
                      Dismiss
                    </Button>
                  }
                >
                  {f.text}
                </Alert>
              ))}
              <p className="u-muted">
                Flags are simple thresholds on today&apos;s figures, not trends: earlier weeks are
                not kept yet.
              </p>
            </div>
          ) : null}
          <StatGrid
            items={[
              {
                label: 'Open observations',
                value: k.observations.open,
                hint: `${k.observations.overdue} overdue`,
                tone: k.observations.overdue > 0 ? 'danger' : undefined,
              },
              {
                label: 'Open defects',
                value: k.defects.open,
                hint: `${k.defects.overdue} overdue`,
                tone: k.defects.overdue > 0 ? 'danger' : undefined,
              },
              {
                label: 'Inspections not closed',
                value: k.inspections.open,
                hint: `${k.inspections.overdue} overdue`,
                tone: k.inspections.overdue > 0 ? 'danger' : undefined,
              },
              { label: 'Incidents, last 12 months', value: k.incidentsLast12Months },
            ]}
          />
          {k.hiddenProjects > 0 ? (
            <p className="u-muted">
              {k.hiddenProjects} {k.hiddenProjects === 1 ? 'project is' : 'projects are'} not
              counted: you cannot read these tools there.
            </p>
          ) : null}
          <Card title="Days without an injury or incident">
            {overall ? (
              <div className="stack">
                <StatGrid
                  items={[
                    { label: 'All shown · without injury', value: days(overall.injuryDays) },
                    { label: 'All shown · without incident', value: days(overall.incidentDays) },
                    ...regions.flatMap((r) => [
                      {
                        label: `${r.region} · without injury`,
                        value: days(r.injuryDays),
                        hint: `${r.projects} ${r.projects === 1 ? 'project' : 'projects'}`,
                      },
                      { label: `${r.region} · without incident`, value: days(r.incidentDays) },
                    ]),
                  ]}
                />
                <p className="u-muted">
                  A streak runs from the latest event on any project in the group. Near misses do
                  not break it. &quot;None recorded&quot; means nothing has been logged, not that
                  the count is unlimited.
                </p>
              </div>
            ) : (
              <p className="u-muted">You cannot read incidents on these projects.</p>
            )}
          </Card>
          <Card title="Injury-free leaderboard">
            {board.ranked.length === 0 && board.noneRecorded.length === 0 ? (
              <p className="u-muted">You cannot read incidents on these projects.</p>
            ) : (
              <div className="stack">
                {board.ranked.length > 0 ? (
                  <ol className="qs-board" aria-label="Projects by days since last injury">
                    {board.ranked.map((s) => (
                      <li key={s.id}>
                        <Link className="link" href={webRoutes.project(org.orgSlug, s.id)}>
                          {s.name}
                        </Link>
                        <span>{s.region}</span>
                        <strong>{days(s.injuryDays)}</strong>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {board.noneRecorded.length > 0 ? (
                  <p className="u-muted">
                    No injury recorded yet, so not ranked:{' '}
                    {board.noneRecorded.map((s) => s.name).join(', ')}.
                  </p>
                ) : null}
              </div>
            )}
          </Card>
          <div className="chart-grid">
            <SplitCard
              title="Observations by project"
              rows={splitRows(projects, 'observations')}
              orgSlug={org.orgSlug}
            />
            <SplitCard
              title="Defects (punch) by project"
              rows={splitRows(projects, 'defects')}
              orgSlug={org.orgSlug}
            />
            <SplitCard
              title="Inspections by project"
              rows={splitRows(projects, 'inspections')}
              orgSlug={org.orgSlug}
            />
            <Card title="Incidents in the last 12 months">
              {incidentBars.length > 0 ? (
                <ToneBars
                  bars={incidentBars}
                  ariaLabel="Incidents in the last 12 months by project"
                />
              ) : (
                <p className="u-muted">No incidents recorded in the last 12 months.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
