'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { WARRANTY_SYSTEMS } from '@archova/domain';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type {
  WarrantyFlag,
  WarrantyItem,
  WarrantyResponsibleType,
  WarrantyState,
  WarrantySystem,
} from '../data/api';
import { useWarrantyItems, useWarrantyMutations, useWarrantySummary } from '../hooks/useWarranty';

export const SYSTEM_LABELS: Record<WarrantySystem, string> = {
  structure: 'Structure',
  roof: 'Roof',
  waterproofing: 'Waterproofing',
  facade_windows: 'Façade and windows',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'Air conditioning and ventilation',
  fire_services: 'Fire services',
  lifts: 'Lifts',
  finishes: 'Finishes',
  appliances: 'Appliances',
  landscaping: 'Landscaping',
  other: 'Other',
};
export const RESPONSIBLE_LABELS: Record<WarrantyResponsibleType, string> = {
  builder: 'Builder',
  subcontractor: 'Subcontractor',
  supplier: 'Supplier',
};
export const STATE_LABELS: Record<WarrantyState, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
};
export const STATE_TONE = { active: 'success', expiring: 'warning', expired: 'neutral' } as const;
const FLAG_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

/** Whether the caller keeps the warranty register: org owners and admins, and project admins on the defects tool. */
export function useCanManageWarranty() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  return {
    pending: perms.isPending,
    canManage:
      perms.data?.orgRole === 'owner' ||
      perms.data?.orgRole === 'admin' ||
      atLeast(perms.data?.toolLevels.defects, 'admin'),
  };
}

/** What Nova points out, from rules alone. Each flag links to the item it is about. */
export function FlagList({
  flags,
  orgSlug,
  projectId,
}: {
  flags: WarrantyFlag[];
  orgSlug: string;
  projectId: string;
}) {
  if (flags.length === 0) return null;
  return (
    <Card title="Nova flags">
      <ul className="stack" aria-label="Warranty flags">
        {flags.map((f, i) => (
          <li key={`${f.kind}-${f.itemId ?? ''}-${f.claimId ?? ''}-${i}`}>
            <Alert tone={FLAG_TONE[f.severity]}>
              {f.message}{' '}
              {f.itemId ? (
                <Link className="link" href={webRoutes.warrantyItem(orgSlug, projectId, f.itemId)}>
                  Open item
                </Link>
              ) : null}
            </Alert>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Post-handover warranty register: what is under warranty, who answers for it, when it ends and how many claims it
 * has had. Builder staff keep it; owners and clients read it, so they can see the same expiry dates the builder does.
 */
export function WarrantyScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { canManage, pending } = useCanManageWarranty();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'warranty', id: 'register' },
  });
  const [state, setState] = useState<WarrantyState | ''>('');
  const items = useWarrantyItems(project.projectId);
  const summary = useWarrantySummary(project.projectId);
  const directory = useProjectDirectory();
  if (items.isPending || pending) return <SkeletonRows label="Loading warranty register…" />;

  const rows = (items.data ?? []).filter((i) => !state || i.state === state);
  const who = (i: WarrantyItem) =>
    i.responsibleCompanyId
      ? directory.companyName(i.responsibleCompanyId)
      : (i.responsibleName ?? RESPONSIBLE_LABELS[i.responsibleType]);
  const columns: DataTableColumn<WarrantyItem>[] = [
    {
      id: 'name',
      header: 'Item',
      rowHeader: true,
      cell: (i) => (
        <Link className="link" href={webRoutes.warrantyItem(org.orgSlug, project.projectId, i.id)}>
          {i.numberLabel} {i.name}
        </Link>
      ),
    },
    { id: 'system', header: 'System', cell: (i) => SYSTEM_LABELS[i.system] },
    { id: 'who', header: 'Responsible', cell: who },
    {
      id: 'expiry',
      header: 'Ends',
      sortValue: (i) => i.expiryDate,
      cell: (i) => formatLocalDate(i.expiryDate),
    },
    {
      id: 'state',
      header: 'Status',
      cell: (i) => <StatusPill tone={STATE_TONE[i.state]}>{STATE_LABELS[i.state]}</StatusPill>,
    },
    {
      id: 'claims',
      header: 'Claims',
      align: 'end',
      cell: (i) => `${i.openClaimCount} open of ${i.claimCount}`,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Warranty"
        description="What is under warranty after handover, who answers for it, when it ends and the claims made."
      />
      <ErrorAlert
        error={items.error ?? summary.error}
        title="We couldn't load the warranty register"
      />
      {summary.data ? (
        <p className="u-muted">
          {summary.data.itemCount} items · {summary.data.expiringCount} expiring soon ·{' '}
          {summary.data.expiredCount} expired · {summary.data.openClaimCount} open claims ·{' '}
          {summary.data.closedClaimCount} closed
        </p>
      ) : null}
      {summary.data ? (
        <FlagList flags={summary.data.flags} orgSlug={org.orgSlug} projectId={project.projectId} />
      ) : null}
      <Select
        label="Show"
        value={state}
        onChange={(e) => setState(e.target.value as WarrantyState | '')}
        options={[
          { value: '', label: 'All items' },
          ...(Object.keys(STATE_LABELS) as WarrantyState[]).map((s) => ({
            value: s,
            label: STATE_LABELS[s],
          })),
        ]}
      />
      <DataTable
        caption="Warranty register"
        columns={columns}
        rows={rows}
        getRowId={(i) => i.id}
        empty={
          <EmptyState
            title="No warranty items"
            description={
              canManage ? 'Add the first system below.' : 'Nothing has been registered yet.'
            }
          />
        }
      />
      {canManage ? <AddItemForm /> : null}
    </div>
  );
}

function AddItemForm() {
  const project = useCurrentProject();
  const directory = useProjectDirectory();
  const m = useWarrantyMutations(project.projectId);
  const today = todayIn(project.timezone);
  const [name, setName] = useState('');
  const [system, setSystem] = useState<WarrantySystem>('roof');
  const [type, setType] = useState<WarrantyResponsibleType>('subcontractor');
  const [companyId, setCompanyId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [months, setMonths] = useState('12');
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const durationMonths = Number(months);
    if (!name.trim()) return setError('Name the item.');
    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 600)
      return setError('Enter the warranty length in whole months, 1 to 600.');
    if (type !== 'builder' && !companyId && !supplier.trim())
      return setError('Pick the company, or type the supplier’s name.');
    m.create.mutate(
      {
        name: name.trim(),
        system,
        responsibleType: type,
        startDate,
        durationMonths,
        ...(companyId ? { responsibleCompanyId: companyId } : {}),
        ...(!companyId && supplier.trim() ? { responsibleName: supplier.trim() } : {}),
      },
      { onSuccess: () => setName('') },
    );
  }

  return (
    <Card title="Add a warranty item">
      <form className="stack-lg" onSubmit={save} noValidate>
        <TextField label="Item" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-row">
          <Select
            label="System"
            value={system}
            onChange={(e) => setSystem(e.target.value as WarrantySystem)}
            options={WARRANTY_SYSTEMS.map((s) => ({ value: s, label: SYSTEM_LABELS[s] }))}
          />
          <Select
            label="Answerable"
            value={type}
            onChange={(e) => setType(e.target.value as WarrantyResponsibleType)}
            options={(Object.keys(RESPONSIBLE_LABELS) as WarrantyResponsibleType[]).map((t) => ({
              value: t,
              label: RESPONSIBLE_LABELS[t],
            }))}
          />
        </div>
        {type === 'builder' ? null : (
          <div className="form-row">
            <Select
              label="Company on the project"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              options={[
                { value: '', label: 'Not on the project' },
                ...directory.companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            {companyId ? null : (
              <TextField
                label="Supplier or installer"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            )}
          </div>
        )}
        <div className="form-row">
          <TextField
            label="Starts"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            label="Length (months)"
            type="number"
            required
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.create.error} title="We couldn't add this item" />
        <div className="row-actions">
          <Button type="submit" disabled={m.create.isPending}>
            {m.create.isPending ? 'Saving…' : 'Add item'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
