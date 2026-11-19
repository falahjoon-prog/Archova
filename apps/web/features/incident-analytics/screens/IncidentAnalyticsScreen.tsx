'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  HARM_SOURCE_LABELS,
  INJURY_OUTCOME_LABELS,
  INJURY_TYPE_LABELS,
  type BodyPart,
  type HarmSource,
  type InjuryOutcome,
  type InjuryType,
} from '@archova/domain';
import { unwrap } from '@archova/api-client';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { api } from '@/shared/lib/api';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { usePortfolio } from '@/features/reporting';
import { BodyMap } from '../components/BodyMap';
import { BarList, DaysGauge, Donut, StackBar } from '../components/Charts';
import { useIncidentAnalytics } from '../hooks/useIncidentAnalytics';
import { harmSourceColour, injuryTypeColour, outcomeColour } from '../lib/colours';
import { NO_FILTERS, type AnalyticsFilters, type IncidentAnalyticsRow } from '../lib/types';

const UNKNOWN = 'Not recorded';
const bodyLabel = (k: string | null) => (k ? (BODY_PART_LABELS[k as BodyPart] ?? k) : UNKNOWN);
const typeLabel = (k: string | null) => (k ? (INJURY_TYPE_LABELS[k as InjuryType] ?? k) : UNKNOWN);
const sourceLabel = (k: string | null) =>
  k ? (HARM_SOURCE_LABELS[k as HarmSource] ?? k) : UNKNOWN;
const outcomeLabel = (k: string | null) =>
  k ? (INJURY_OUTCOME_LABELS[k as InjuryOutcome] ?? k) : UNKNOWN;
const rate = (n: number | null) => (n === null ? '—' : n.toFixed(1));

/** Injuries across every project you can see: where on the body, what caused them, how serious, and the rates. */
export function IncidentAnalyticsScreen() {
  const org = useCurrentOrg();
  const [filters, setFilters] = useState<AnalyticsFilters>(NO_FILTERS);
  const set = (patch: Partial<AnalyticsFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const analytics = useIncidentAnalytics(filters);
  const projects = usePortfolio(true);
  const companies = useQuery({
    queryKey: ['orgs', org.orgId, 'companies', 'filter'],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/companies', {
          params: { path: { orgId: org.orgId }, query: { limit: 200 } },
        }),
      ).data,
    staleTime: 5 * 60_000,
  });
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const data = analytics.data;
  const s = data?.summary;

  const columns: DataTableColumn<IncidentAnalyticsRow>[] = [
    {
      id: 'date',
      header: 'Date',
      sortValue: (r) => r.localDate,
      cell: (r) => formatLocalDate(r.localDate),
    },
    {
      id: 'incident',
      header: 'Incident',
      rowHeader: true,
      sortValue: (r) => r.ref,
      cell: (r) => (
        <Link className="link" href={`${webRoutes.project(org.orgSlug, r.projectId)}/incidents`}>
          {r.ref}
        </Link>
      ),
    },
    {
      id: 'project',
      header: 'Project',
      sortValue: (r) => r.projectName,
      cell: (r) => r.projectName,
    },
    {
      id: 'person',
      header: 'Injured person',
      sortValue: (r) => r.personName,
      cell: (r) => r.personName,
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (r) => (r.companyId ? (companyName.get(r.companyId) ?? '') : ''),
      cell: (r) => (r.companyId ? (companyName.get(r.companyId) ?? '—') : '—'),
    },
    {
      id: 'body',
      header: 'Body part',
      sortValue: (r) => bodyLabel(r.bodyPart),
      cell: (r) => bodyLabel(r.bodyPart),
    },
    {
      id: 'type',
      header: 'Injury type',
      sortValue: (r) => typeLabel(r.injuryType),
      cell: (r) => typeLabel(r.injuryType),
    },
    {
      id: 'source',
      header: 'Cause',
      sortValue: (r) => sourceLabel(r.harmSource),
      cell: (r) => sourceLabel(r.harmSource),
    },
    {
      id: 'outcome',
      header: 'Outcome',
      sortValue: (r) => outcomeLabel(r.outcome),
      cell: (r) => outcomeLabel(r.outcome),
    },
    {
      id: 'days',
      header: 'Days lost',
      align: 'end',
      sortValue: (r) => r.daysLost,
      cell: (r) => r.daysLost || '—',
    },
  ];

  return (
    <div className="stack-lg ia-viz">
      <PageHeader
        eyebrow="Company"
        title="Injury analytics"
        description="Injuries recorded on incidents across the projects you can see. Injury details are health information, so only projects where you may view it are counted."
      />
      <FilterBar label="Injury filters">
        <Select
          label="Project"
          value={filters.projectId}
          placeholder="All projects"
          options={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(e) => set({ projectId: e.target.value })}
        />
        <Select
          label="Company"
          value={filters.companyId}
          placeholder="All companies"
          options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => set({ companyId: e.target.value })}
        />
        <Select
          label="Body part"
          value={filters.bodyPart}
          placeholder="Any body part"
          options={BODY_PARTS.map((p) => ({ value: p, label: BODY_PART_LABELS[p] }))}
          onChange={(e) => set({ bodyPart: e.target.value })}
        />
        <TextField
          label="From"
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => set({ from: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => set({ to: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={analytics.error} title="We couldn't load the injury analytics" />
      {data && data.projectsRestricted > 0 ? (
        <Alert tone="info" title="Some projects are not included">
          {data.projectsRestricted} {data.projectsRestricted === 1 ? 'project is' : 'projects are'}{' '}
          left out because you may not view health information there.
        </Alert>
      ) : null}
      {analytics.isPending ? <SkeletonRows rows={4} /> : null}
      {data && s ? (
        <>
          <StatGrid
            items={[
              { label: 'Injuries', value: s.injuries, hint: `${data.from} to ${data.to}` },
              {
                label: 'Lost time injuries',
                value: s.lostTimeInjuries,
                tone: s.lostTimeInjuries > 0 ? 'danger' : undefined,
                hint: `${s.daysLost} ${s.daysLost === 1 ? 'day' : 'days'} lost`,
              },
              {
                label: 'LTIFR',
                value: rate(s.ltifr),
                hint:
                  s.ltifr === null
                    ? 'No hours on submitted timesheets'
                    : 'Lost time injuries per million hours',
              },
              {
                label: 'TRIFR',
                value: rate(s.trifr),
                hint:
                  s.trifr === null
                    ? 'No hours on submitted timesheets'
                    : 'Recordable injuries per million hours',
              },
              {
                label: 'Hours worked',
                value:
                  s.hoursWorked === null ? '—' : Math.round(s.hoursWorked).toLocaleString('en-AU'),
                hint: 'From submitted and approved timesheets',
              },
              {
                label: 'Notifiable',
                value: s.notifiable,
                tone: s.notifiable > 0 ? 'warning' : undefined,
                hint: 'Injuries on notifiable incidents',
              },
            ]}
          />
          <div className="ia-grid ia-grid--bodymap">
            <Card title="Where people were hurt">
              <BodyMap
                byBodyPart={s.byBodyPart}
                selected={filters.bodyPart}
                onSelect={(part) => set({ bodyPart: part })}
              />
            </Card>
            <div className="stack-lg">
              <Card title="Time since the last one">
                <div className="ia-gauges">
                  <DaysGauge
                    title="Days without an injury"
                    value={data.daysWithoutInjury}
                    noneText="No injury recorded"
                  />
                  <DaysGauge
                    title="Days without an incident"
                    value={data.daysWithoutIncident}
                    noneText="No incident recorded"
                  />
                </div>
              </Card>
              <Card title="How serious">
                <StackBar items={s.byOutcome} label={outcomeLabel} colour={outcomeColour} />
              </Card>
            </div>
          </div>
          <div className="ia-grid ia-grid--2">
            <Card title="Injuries by cause">
              <Donut items={s.byHarmSource} label={sourceLabel} colour={harmSourceColour} />
            </Card>
            <Card title="Injuries by type">
              <BarList items={s.byInjuryType} label={typeLabel} colour={injuryTypeColour} />
            </Card>
          </div>
          <Card title="Injury summary">
            <DataTable
              caption="Injury summary"
              columns={columns}
              rows={data.rows}
              getRowId={(r) => `${r.incidentId}:${r.personName}`}
              defaultSort={{ columnId: 'date', direction: 'desc' }}
              density="compact"
              empty={
                <EmptyState
                  title="No injuries match"
                  description="Change the filters, or record the body part and outcome when you report an injury."
                />
              }
            />
            {data.rowsTruncated ? (
              <p className="u-caption">
                Showing the 500 most recent. Narrow the dates to see the rest.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
