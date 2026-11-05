'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { DelaysIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { DelayRow, RegisterFilters } from '../data/api';
import { useDelayRegister } from '../hooks/useSchedule';
import { CAUSE_LABELS, KIND_LABELS, SOURCE_LABELS, timeLost } from '../lib/labels';

const CAUSE_OPTIONS = Object.entries(CAUSE_LABELS).map(([value, label]) => ({ value, label }));
const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

/** Every delay the project has recorded, in one list to build an EOT case from (SCH-US2, SCH-AC2). */
export function DelayRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'delays', id: 'register' },
  });
  const [filters, setFilters] = useState<RegisterFilters>({});
  const register = useDelayRegister(project.projectId, filters);
  const set = (patch: Partial<RegisterFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const columns: DataTableColumn<DelayRow>[] = [
    {
      id: 'date',
      header: 'Date',
      rowHeader: true,
      sortValue: (r) => r.date,
      cell: (r) => formatLocalDate(r.date),
    },
    {
      id: 'source',
      header: 'Source',
      sortValue: (r) => r.kind,
      cell: (r) => KIND_LABELS[r.kind],
    },
    {
      id: 'cause',
      header: 'Cause',
      sortValue: (r) => r.cause,
      cell: (r) => CAUSE_LABELS[r.cause],
    },
    {
      id: 'what',
      header: 'What happened',
      cell: (r) => {
        const href =
          r.source === 'rfi' && r.rfiId
            ? webRoutes.rfi(org.orgSlug, project.projectId, r.rfiId)
            : r.diaryDate
              ? webRoutes.diary(org.orgSlug, project.projectId, r.diaryDate)
              : null;
        return href ? (
          <Link className="link" href={href}>
            {r.title}
          </Link>
        ) : (
          r.title
        );
      },
    },
    {
      id: 'lost',
      header: 'Time lost',
      sortValue: (r) => r.days ?? (r.hours !== null ? r.hours / 8 : 0),
      cell: (r) => <span className="u-mono">{timeLost(r)}</span>,
    },
    {
      id: 'eot',
      header: 'Possible EOT',
      sortValue: (r) => (r.possibleEot ? 1 : 0),
      cell: (r) =>
        r.possibleEot ? (
          <StatusPill tone="warning">Possible EOT</StatusPill>
        ) : (
          <span className="u-muted">—</span>
        ),
    },
  ];

  const t = register.data?.totals;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Delay register"
        description="Delays from the site diary, RFIs with a schedule impact and RFIs answered late. Each row links to its source."
      />
      <FilterBar label="Delay filters">
        <Select
          label="Cause"
          placeholder="All causes"
          options={CAUSE_OPTIONS}
          value={filters.cause ?? ''}
          onChange={(e) => {
            const { cause: _drop, ...rest } = filters;
            setFilters(
              e.target.value
                ? { ...rest, cause: e.target.value as RegisterFilters['cause'] }
                : rest,
            );
          }}
        />
        <Select
          label="Source"
          placeholder="Diary and RFIs"
          options={SOURCE_OPTIONS}
          value={filters.source ?? ''}
          onChange={(e) => {
            const { source: _drop, ...rest } = filters;
            setFilters(
              e.target.value ? { ...rest, source: e.target.value as 'diary' | 'rfi' } : rest,
            );
          }}
        />
        <Checkbox
          label="Possible EOT only"
          checked={filters.eotOnly ?? false}
          onChange={(e) => set({ eotOnly: e.target.checked })}
        />
      </FilterBar>
      <ErrorAlert error={register.error} title="We couldn't load the delay register" />
      {register.isPending ? (
        <SkeletonRows label="Loading the delay register…" />
      ) : register.data ? (
        <>
          {t ? (
            <dl className="details" aria-label="Totals for the rows shown">
              <div>
                <dt>Rows</dt>
                <dd>{t.rows}</dd>
              </div>
              <div>
                <dt>Possible EOT</dt>
                <dd>{t.possibleEotRows}</dd>
              </div>
              <div>
                <dt>Diary hours lost</dt>
                <dd className="u-mono">{t.diaryHours} h</dd>
              </div>
              <div>
                <dt>RFI days</dt>
                <dd className="u-mono">{t.rfiDays}</dd>
              </div>
            </dl>
          ) : null}
          {register.data.truncated ? (
            <p className="u-caption" role="status">
              Only the most recent rows are shown. Narrow the filters to see older ones.
            </p>
          ) : null}
          <DataTable
            caption="Delay register"
            columns={columns}
            rows={register.data.data}
            getRowId={(r) => r.id}
            defaultSort={{ columnId: 'date', direction: 'desc' }}
            empty={
              <EmptyState
                icon={DelaysIcon}
                title="No delays recorded"
                description="Delays you add to the site diary, and RFIs with a schedule impact or a late answer, appear here."
              />
            }
          />
        </>
      ) : null}
    </div>
  );
}
