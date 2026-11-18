'use client';

import { useState } from 'react';
import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  StatGrid,
  StatusPill,
  ToneBars,
  type DataTableColumn,
} from '@archova/ui';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { SustainabilityPortfolio, SustainabilityProject } from '../lib/types';

const FLAG_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const;
const SHOWN_FLAGS = 6;
const t = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 1 })} t`;
const co2 = (kg: number) =>
  kg >= 1000
    ? `${(kg / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1 })} t CO₂-e`
    : `${Math.round(kg)} kg CO₂-e`;
const pts = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

/** Company sustainability: permit breaches, waste diverted from landfill, emissions, and Nova's rule-based flags. */
export function Sustainability({ portfolio }: { portfolio: SustainabilityPortfolio }) {
  const org = useCurrentOrg();
  const [showAll, setShowAll] = useState(false);
  const { totals, projects, flags } = portfolio;

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Sustainability figures appear here for the projects you can see."
      />
    );
  }
  const shown = showAll ? flags : flags.slice(0, SHOWN_FLAGS);
  const trend = pts(totals.last30DiversionPercent, totals.previous30DiversionPercent);
  const readable = projects.filter((p) => !p.restricted);
  const bars = readable
    .filter((p) => p.waste.diversionPercent !== null)
    .sort((a, b) => (a.waste.diversionPercent ?? 0) - (b.waste.diversionPercent ?? 0))
    .slice(0, 8)
    .map((p) => ({
      label: p.name,
      value: p.waste.diversionPercent ?? 0,
      tone: (p.waste.diversionPercent ?? 0) >= 80 ? ('success' as const) : ('warning' as const),
    }));

  const columns: DataTableColumn<SustainabilityProject>[] = [
    {
      id: 'name',
      header: 'Project',
      rowHeader: true,
      sortValue: (p) => p.name,
      cell: (p) => (
        <Link className="link" href={webRoutes.environment(org.orgSlug, p.id)}>
          {p.name}
        </Link>
      ),
    },
    {
      id: 'breaches',
      header: 'Breaches',
      sortValue: (p) => p.monitoring.openBreaches,
      cell: (p) =>
        p.restricted ? (
          <StatusPill tone="neutral">No access</StatusPill>
        ) : p.monitoring.openBreaches > 0 ? (
          <StatusPill tone="danger">{p.monitoring.openBreaches} open</StatusPill>
        ) : (
          '0'
        ),
    },
    {
      id: 'conditions',
      header: 'Permit conditions',
      sortValue: (p) => p.conditions.nonCompliant,
      cell: (p) =>
        p.restricted ? (
          '—'
        ) : !p.hasPlan ? (
          'No plan'
        ) : (
          <>
            {p.conditions.compliancePercent === null ? '—' : `${p.conditions.compliancePercent}%`}
            {p.conditions.nonCompliant > 0 ? (
              <StatusPill tone="danger">{p.conditions.nonCompliant} non-compliant</StatusPill>
            ) : null}
          </>
        ),
    },
    {
      id: 'waste',
      header: 'Waste diverted',
      sortValue: (p) => p.waste.diversionPercent ?? -1,
      cell: (p) => {
        if (p.restricted || p.waste.diversionPercent === null) return '—';
        const d = pts(p.waste.last30DiversionPercent, p.waste.previous30DiversionPercent);
        return (
          <>
            {p.waste.diversionPercent}%{' '}
            <span className="u-caption">of {t(p.waste.totalTonnes)}</span>
            {d !== null && d <= -10 ? <StatusPill tone="warning">Falling</StatusPill> : null}
          </>
        );
      },
    },
    {
      id: 'carbon',
      header: 'Emissions, 30 days',
      sortValue: (p) => p.carbon.last30Kg,
      cell: (p) =>
        p.restricted ? (
          '—'
        ) : (
          <>
            {co2(p.carbon.last30Kg)}
            {p.carbon.changePercent !== null && p.carbon.previous30Kg >= 1000 ? (
              <span className="u-caption">
                {' '}
                {p.carbon.changePercent >= 0 ? '+' : ''}
                {p.carbon.changePercent}%
              </span>
            ) : null}
          </>
        ),
    },
    {
      id: 'attention',
      header: 'To chase',
      sortValue: (p) => p.attention,
      cell: (p) => p.attention,
    },
  ];

  return (
    <div className="stack-lg">
      {flags.length > 0 ? (
        <section className="stack" aria-label="Nova flags">
          {shown.map((f) => (
            <Alert
              key={`${f.projectId}-${f.code}`}
              tone={FLAG_TONE[f.severity]}
              title={`Nova · ${f.projectName}`}
            >
              {f.message}
            </Alert>
          ))}
          {flags.length > SHOWN_FLAGS ? (
            <div>
              <Button variant="tertiary" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer flags' : `Show all ${flags.length} flags`}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <StatGrid
        items={[
          {
            label: 'Open breaches',
            value: totals.openBreaches,
            hint: `${totals.nonCompliantConditions} conditions non-compliant`,
            tone: totals.openBreaches > 0 ? 'danger' : 'neutral',
          },
          {
            label: 'Waste diverted',
            value: totals.diversionPercent === null ? '—' : `${totals.diversionPercent}%`,
            hint:
              trend === null
                ? `${t(totals.wasteTonnes)} in total`
                : `${trend >= 0 ? 'Up' : 'Down'} ${Math.abs(trend)} points on the 30 days before`,
            tone: trend !== null && trend <= -10 ? 'warning' : 'neutral',
          },
          { label: 'To landfill', value: t(totals.landfillTonnes) },
          {
            label: 'Emissions, 30 days',
            value: co2(totals.carbonLast30Kg),
            hint:
              totals.carbonChangePercent === null
                ? `${co2(totals.carbonKg)} in total`
                : `${totals.carbonChangePercent >= 0 ? 'Up' : 'Down'} ${Math.abs(totals.carbonChangePercent)}% on the 30 days before`,
            tone:
              totals.carbonChangePercent !== null && totals.carbonChangePercent >= 25
                ? 'warning'
                : 'neutral',
          },
        ]}
      />
      {totals.projectsRestricted > 0 || totals.projectsWithoutPlan > 0 ? (
        <p className="u-muted">
          {totals.projectsRestricted > 0
            ? `${totals.projectsRestricted} ${totals.projectsRestricted === 1 ? 'project is' : 'projects are'} left out because you cannot open their environmental tools. `
            : ''}
          {totals.projectsWithoutPlan > 0
            ? `${totals.projectsWithoutPlan} ${totals.projectsWithoutPlan === 1 ? 'project has' : 'projects have'} no Environmental Management Plan yet.`
            : ''}
        </p>
      ) : null}

      {bars.length > 0 ? (
        <Card title="Waste diverted from landfill, by project (lowest first)">
          <ToneBars bars={bars} ariaLabel="Share of waste diverted from landfill, by project" />
        </Card>
      ) : null}

      <DataTable
        caption="Projects by sustainability"
        columns={columns}
        rows={projects}
        getRowId={(p) => p.id}
      />
      {portfolio.truncated ? (
        <Alert tone="info" title="Showing the first 200 projects">
          Close out finished projects to bring the rest into view.
        </Alert>
      ) : null}
    </div>
  );
}
