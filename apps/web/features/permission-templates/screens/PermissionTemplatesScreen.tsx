'use client';

import {
  Card,
  DataTable,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { PermissionTemplate } from '../data/api';
import { usePermissionTemplatesList } from '../hooks/usePermissionTemplatesList';

const TOOLS: Array<[string, string]> = [
  ['documents', 'Documents and drawings'],
  ['rfis', 'RFIs'],
  ['submittals', 'Submittals'],
  ['correspondence', 'Correspondence'],
  ['diary', 'Site diary'],
  ['defects', 'Defects'],
  ['meetings', 'Meetings'],
  ['inspections', 'Quality and safety'],
  ['incidents', 'Incidents'],
  ['budget', 'Budget'],
  ['commitments', 'Commitments'],
  ['variations', 'Variations'],
  ['payment_claims', 'Payment claims'],
  ['directory', 'Directory'],
  ['workforce', 'Workforce'],
  ['project_admin', 'Project admin'],
  ['owner_portal', 'Owner portal'],
];
const TOOL_LABEL = Object.fromEntries(TOOLS);
const LEVEL_LABEL: Record<string, string> = {
  none: 'None',
  read: 'View',
  standard: 'Standard',
  admin: 'Admin',
};
const LEVEL_TONE: Record<string, StatusTone> = {
  none: 'neutral',
  read: 'info',
  standard: 'warning',
  admin: 'success',
};
const GRANULAR_LABEL: Record<string, string> = {
  'financials.variations.approve': 'Approve variations',
  'financials.payment_schedules.issue': 'Issue payment schedules',
};

interface Row {
  key: string;
  label: string;
}

/** What each permission template lets a person do on a project; the one you pick when you add someone. */
export function PermissionTemplatesScreen() {
  const list = usePermissionTemplatesList();
  const templates = list.data ?? [];
  const rows: Row[] = TOOLS.map(([key, label]) => ({ key, label }));
  const columns: DataTableColumn<Row>[] = [
    { id: 'tool', header: 'Tool', rowHeader: true, cell: (r) => r.label },
    ...templates.map((t): DataTableColumn<Row> => ({
      id: t.id,
      header: t.name,
      cell: (r) => {
        const level = t.toolLevels[r.key as keyof typeof t.toolLevels] ?? 'none';
        return (
          <StatusPill tone={LEVEL_TONE[level] ?? 'neutral'}>
            {LEVEL_LABEL[level] ?? level}
          </StatusPill>
        );
      },
    })),
  ];
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Permission templates"
        description="What each role can do on a project. You choose one when you add someone to a project."
      />
      <ErrorAlert error={list.error} title="We couldn't load permission templates" />
      {list.isPending ? (
        <SkeletonRows label="Loading permission templates…" />
      ) : (
        <div className="stack">
          <DataTable
            caption="Access by tool"
            columns={columns}
            rows={rows}
            getRowId={(r) => r.key}
          />
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      )}
    </>
  );
}

function TemplateCard({ template: t }: { template: PermissionTemplate }) {
  return (
    <Card>
      <h2>{t.name}</h2>
      <p>{t.description}</p>
      {t.granular.length > 0 ? (
        <p>Can also: {t.granular.map((g) => GRANULAR_LABEL[g] ?? g).join(', ')}.</p>
      ) : null}
      {t.companyScopedTools.length > 0 ? (
        <p>
          Sees only their own company&apos;s records in:{' '}
          {t.companyScopedTools.map((k) => TOOL_LABEL[k] ?? k).join(', ')}.
        </p>
      ) : null}
    </Card>
  );
}
