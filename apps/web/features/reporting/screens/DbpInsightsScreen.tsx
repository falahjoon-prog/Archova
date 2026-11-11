'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { HomeIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useDbpInsights } from '../hooks/useReporting';
import { Bars, Donut, Gauge, TrendLine, type Slice } from '../components/charts';
import {
  CATEGORY_LABELS,
  CLASS_LABELS,
  CLASS_ORDER,
  CONDITION_TEXT,
  monthLabel,
  sumClasses,
  type ClassKey,
  type DbpClassCounts,
  type DbpInsights,
} from '../lib/dbpLabels';

const CLASS_COLOURS: Record<ClassKey, string> = {
  serious_defect: 'var(--chart-serious)',
  potential_serious_defect: 'var(--chart-potential)',
  low_risk: 'var(--chart-low)',
  unclassified: 'var(--chart-unclassified)',
};

const slices = (c: DbpClassCounts): Slice[] =>
  CLASS_ORDER.map((k) => ({
    key: k,
    label: CLASS_LABELS[k],
    value: c[k],
    color: CLASS_COLOURS[k],
  }));

type ProjectRow = DbpInsights['projects'][number];

function ProjectCell({ n, tone }: { n: number; tone: 'danger' | 'warning' }) {
  return n > 0 ? <StatusPill tone={tone}>{n}</StatusPill> : <span className="u-muted">0</span>;
}

/** NSW DBP Act reporting: pass rates and observation risk classes by building element, across the projects you can see. */
export function DbpInsightsScreen() {
  const org = useCurrentOrg();
  const [includeClosed, setIncludeClosed] = useState(false);
  const q = useDbpInsights(includeClosed);
  const data = q.data;

  const columns: DataTableColumn<ProjectRow>[] = [
    {
      id: 'project',
      header: 'Project',
      rowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <Link className="link" href={webRoutes.project(org.orgSlug, r.id)}>
          {r.name}
        </Link>
      ),
    },
    ...CLASS_ORDER.map<DataTableColumn<ProjectRow>>((k) => ({
      id: k,
      header: CLASS_LABELS[k],
      align: 'end',
      sortValue: (r) => r.classifications[k],
      cell: (r) =>
        r.restricted ? <span className="u-muted">No access</span> : r.classifications[k],
    })),
    {
      id: 'lateInspections',
      header: 'Late inspections',
      align: 'end',
      sortValue: (r) => r.lateInspections,
      cell: (r) => <ProjectCell n={r.lateInspections} tone="danger" />,
    },
    {
      id: 'lateObservations',
      header: 'Late observations',
      align: 'end',
      sortValue: (r) => r.lateObservations,
      cell: (r) => <ProjectCell n={r.lateObservations} tone="warning" />,
    },
  ];

  const totalObs = data ? sumClasses(data.classificationTotals) : 0;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="DBP Act insights"
        description="Inspection pass rates and open observations by building element, across every project you can see. A person classifies each observation; Archova only counts what was recorded."
      />
      <ErrorAlert error={q.error} title="We couldn't load the insights" />
      {data ? (
        <StatGrid
          items={[
            {
              label: 'Serious defects open',
              value: data.classificationTotals.serious_defect,
              tone: data.classificationTotals.serious_defect > 0 ? 'danger' : undefined,
            },
            {
              label: 'Potential serious defects',
              value: data.classificationTotals.potential_serious_defect,
              tone: data.classificationTotals.potential_serious_defect > 0 ? 'warning' : undefined,
            },
            {
              label: 'Open observations',
              value: totalObs,
              hint: `${data.classificationTotals.unclassified} not yet classified`,
            },
            {
              label: 'Late inspections',
              value: data.categories.reduce((a, c) => a + c.lateInspections, 0),
              tone: data.categories.some((c) => c.lateInspections > 0) ? 'danger' : undefined,
            },
          ]}
        />
      ) : null}
      {data && data.restrictedProjects > 0 ? (
        <Alert tone="info" title="Some projects are left out">
          {data.restrictedProjects} {data.restrictedProjects === 1 ? 'project is' : 'projects are'}{' '}
          not counted because you can't open inspections there.
        </Alert>
      ) : null}
      {data?.truncated ? (
        <Alert tone="info" title="Showing part of the records">
          Very large registers or more than 200 projects were cut short.
        </Alert>
      ) : null}
      <Checkbox
        label="Include closed and archived projects"
        checked={includeClosed}
        onChange={(e) => setIncludeClosed(e.target.checked)}
      />
      {q.isPending ? (
        <SkeletonRows label="Loading the insights…" />
      ) : !data || (data.categories.length === 0 && data.projects.length === 0) ? (
        <EmptyState
          icon={HomeIcon}
          title="Nothing to show yet"
          description="Set a building element on a checklist and classify observations, and the figures appear here."
        />
      ) : (
        <>
          <div className="dbp-grid">
            {data.categories.map((c) => (
              <Card
                key={c.category}
                title={CATEGORY_LABELS[c.category] ?? c.category}
                headingLevel={3}
              >
                <div className="dbp-cat">
                  <Gauge
                    percent={c.itemsPassing.rate}
                    label={`${CATEGORY_LABELS[c.category]} items passing`}
                  />
                  <p className="u-muted">
                    Items passing ({c.itemsPassing.pass} of{' '}
                    {c.itemsPassing.pass + c.itemsPassing.fail} answered)
                  </p>
                  <div className="dbp-cat__stats">
                    <StatusPill tone={c.lateInspections > 0 ? 'danger' : 'success'}>
                      {c.lateInspections} late inspections
                    </StatusPill>
                    <StatusPill tone={c.lateObservations > 0 ? 'warning' : 'success'}>
                      {c.lateObservations} late observations
                    </StatusPill>
                  </div>
                  <Donut
                    slices={slices(c.classifications)}
                    centre={sumClasses(c.classifications)}
                  />
                </div>
              </Card>
            ))}
          </div>
          <div className="dbp-grid">
            <Card title="Open observations by classification" headingLevel={3}>
              <Donut slices={slices(data.classificationTotals)} centre={totalObs} />
            </Card>
            <Card title="Observations by contributing condition" headingLevel={3}>
              {data.conditions.length === 0 ? (
                <p className="u-muted">No open observations.</p>
              ) : (
                <Bars
                  rows={data.conditions.map((r) => ({
                    key: r.condition,
                    label: CONDITION_TEXT[r.condition] ?? r.condition,
                    value: r.count,
                  }))}
                />
              )}
            </Card>
          </div>
          <Card title="Inspection pass rate, last 12 months" headingLevel={3}>
            <TrendLine
              points={data.passRateTrend.map((p) => ({
                label: monthLabel(p.month),
                value: p.rate,
              }))}
            />
          </Card>
          <DataTable
            caption="Classifications and late items by project"
            columns={columns}
            rows={data.projects}
            getRowId={(r) => r.id}
            defaultSort={{ columnId: 'serious_defect', direction: 'desc' }}
            empty={
              <EmptyState
                icon={HomeIcon}
                title="No projects"
                description="Projects you can see appear here."
              />
            }
          />
        </>
      )}
    </div>
  );
}
