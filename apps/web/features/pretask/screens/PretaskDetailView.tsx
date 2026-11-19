'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  ItemHeader,
  PageHeader,
  SkeletonRows,
  StatusPill,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { ChevronLeft, Plus, PretaskIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { usePlanDetail, usePretaskMutations } from '../hooks/usePretask';
import {
  ACTION_LABELS,
  INDUCTION_LABELS,
  RISK_LABELS,
  RISK_TONES,
  STATUS_LABELS,
  type CrewMember,
  type Hazard,
} from '../lib/types';
import { AddCrewDialog, EditHazardsDialog, ReviewDialog, SignDialog } from './dialogs';
import { RowMenu } from './RowMenu';

export function PretaskDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = usePlanDetail(id);
  const m = usePretaskMutations();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [signing, setSigning] = useState<CrewMember | null>(null);
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'pretask', id } });
  const d = q.data;
  const tz = project.timezone;

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.pretaskPlans(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Pre-task plans
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading pre-task plan…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="Pre-task plan" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this plan" />
      </>
    );
  }
  const p = d.plan;
  const isOpen = p.status === 'open';
  const editable = isOpen && d.canEdit;
  const anySigned = d.crew.some((c) => c.signedAt);

  const hazardColumns: DataTableColumn<Hazard>[] = [
    { id: 'hazard', header: 'Hazard', rowHeader: true, cell: (h) => h.hazard },
    {
      id: 'before',
      header: 'Risk before',
      cell: (h) => (
        <StatusPill tone={RISK_TONES[h.riskBefore]}>{RISK_LABELS[h.riskBefore]}</StatusPill>
      ),
    },
    { id: 'controls', header: 'Controls', cell: (h) => h.controls || '—' },
    {
      id: 'after',
      header: 'Risk after',
      cell: (h) => (
        <StatusPill tone={RISK_TONES[h.riskAfter]}>{RISK_LABELS[h.riskAfter]}</StatusPill>
      ),
    },
  ];

  // Three columns so the row menu stays on screen at phone width: company and induction sit under the name.
  const crewColumns: DataTableColumn<CrewMember>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (c) => c.personName,
      cell: (c) => (
        <>
          {c.personName}
          {c.companyId ? (
            <>
              <br />
              <span className="u-muted">{dir.companyName(c.companyId)}</span>
            </>
          ) : null}
          {c.inductionStatus ? (
            <>
              <br />
              <span className="u-muted">{INDUCTION_LABELS[c.inductionStatus]}</span>
            </>
          ) : null}
          {c.swmsRead === false ? (
            <>
              <br />
              <span className="u-muted">Has not read the SWMS</span>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'signature',
      header: 'Signed on',
      sortValue: (c) => c.signedAt ?? '',
      cell: (c) => (
        <>
          {c.signedAt ? (
            <StatusPill tone="success">Signed</StatusPill>
          ) : (
            <StatusPill tone="warning">Not signed</StatusPill>
          )}
          {c.signedAt ? (
            <>
              <br />
              <span className="u-muted">{formatInstant(c.signedAt, tz)}</span>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'menu',
      header: <span className="sr-only">Actions</span>,
      cell: (c) =>
        editable ? (
          <RowMenu
            label={`Actions for ${c.personName}`}
            items={[
              ...(c.signedAt
                ? [
                    {
                      label: 'Clear signature',
                      onSelect: () => m.clearSignature.mutate({ detail: d, crewId: c.id }),
                    },
                  ]
                : [{ label: 'Sign on…', onSelect: () => setSigning(c) }]),
              {
                label: 'Remove from plan',
                disabled: Boolean(c.signedAt),
                onSelect: () => m.removeCrew.mutate({ detail: d, crewId: c.id }),
              },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <p className="u-m-0" style={{ marginBottom: 'var(--space-4)' }}>
        {back}
      </p>
      <ItemHeader
        number={p.numberLabel}
        title={p.taskTitle}
        status={
          p.reviewedAt ? (
            <StatusPill tone="success">Reviewed</StatusPill>
          ) : (
            <StatusPill tone={isOpen ? 'info' : 'warning'}>
              {isOpen ? STATUS_LABELS.open : 'Closed, to review'}
            </StatusPill>
          )
        }
        actions={
          <>
            {isOpen && d.canEdit ? (
              <Button
                disabled={d.closeBlockers.length > 0 || m.transition.isPending}
                onClick={() => m.transition.mutate({ detail: d, action: 'close' })}
              >
                Close plan
              </Button>
            ) : null}
            {!isOpen && d.canReview && !p.reviewedAt ? (
              <Button onClick={() => setReviewing(true)}>Review</Button>
            ) : null}
            {!isOpen && d.canReview ? (
              <Button
                variant="secondary"
                disabled={m.transition.isPending}
                onClick={() => m.transition.mutate({ detail: d, action: 'reopen' })}
              >
                Reopen
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={m.transition.error} title="We couldn't change the plan" />
      {isOpen && d.closeBlockers.length ? (
        <Alert tone="info" title="Before this plan can close">
          {d.closeBlockers[0]}
          {d.closeBlockers.length > 1 ? ` (and ${d.closeBlockers.length - 1} more)` : ''}
        </Alert>
      ) : null}
      {d.warnings.length ? (
        <Alert tone="warning" title="For the supervisor to look at">
          {d.warnings.map((w) => w.message).join(' ')} These never block the plan; a person decides.
        </Alert>
      ) : null}
      <div className="stack">
        <Card title="Details">
          <DescriptionList
            items={[
              { label: 'Work date', value: p.workDate },
              { label: 'Supervisor', value: p.supervisorName },
              { label: 'Location', value: p.location ?? '—' },
              { label: 'Company', value: p.companyId ? dir.companyName(p.companyId) : '—' },
              {
                label: 'SWMS',
                value: d.swms
                  ? `${d.swms.numberLabel} ${d.swms.title}${d.swms.status === 'accepted' ? '' : ` (${d.swms.status.replace(/_/g, ' ')})`}`
                  : 'None linked',
              },
              ...(p.reviewedAt
                ? [
                    {
                      label: 'Reviewed',
                      value: `${formatInstant(p.reviewedAt, tz)}${p.reviewNote ? `: ${p.reviewNote}` : ''}`,
                    },
                  ]
                : []),
            ]}
          />
        </Card>
        <Card
          title="Hazards and controls"
          actions={
            editable ? (
              <Button variant="secondary" disabled={anySigned} onClick={() => setEditing(true)}>
                Edit hazards
              </Button>
            ) : null
          }
        >
          {editable && anySigned ? (
            <p className="u-muted u-m-0">
              Clear the signatures to change the hazards, so everyone signs what is on the plan.
            </p>
          ) : null}
          {p.hazards.length === 0 ? (
            <EmptyState
              icon={PretaskIcon}
              title="No hazards listed"
              description="List what could go wrong and how you will control it. Nova suggests hazards while you edit."
            />
          ) : (
            <DataTable
              caption="Hazards and controls"
              columns={hazardColumns}
              rows={p.hazards}
              getRowId={(h) => h.hazard}
            />
          )}
        </Card>
        <Card
          title="Crew sign-on"
          actions={
            editable ? (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden="true" /> Add people
              </Button>
            ) : null
          }
        >
          <ErrorAlert
            error={m.clearSignature.error ?? m.removeCrew.error}
            title="We couldn't update the crew"
          />
          {d.crew.length === 0 ? (
            <EmptyState
              icon={PretaskIcon}
              title="Nobody on the plan yet"
              description="Add the people doing the task, then each one signs on."
            />
          ) : (
            <DataTable
              caption="Crew sign-on"
              columns={crewColumns}
              rows={d.crew}
              getRowId={(c) => c.id}
            />
          )}
        </Card>
        <Card title="Record trail">
          <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.events.map((e) => (
              <li key={e.id}>
                <strong>{ACTION_LABELS[e.action] ?? e.action}</strong>{' '}
                <span className="u-muted">
                  {formatInstant(e.at, tz)}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {editing ? (
        <EditHazardsDialog
          initial={p.hazards}
          planId={p.id}
          swmsId={p.swmsId}
          pending={m.setHazards.isPending}
          error={m.setHazards.error}
          onClose={() => setEditing(false)}
          onSave={(hazards) =>
            m.setHazards.mutate({ detail: d, hazards }, { onSuccess: () => setEditing(false) })
          }
        />
      ) : null}
      {adding ? (
        <AddCrewDialog
          companies={dir.companies.map((c) => ({ id: c.id, name: c.name }))}
          pending={m.addCrew.isPending}
          error={m.addCrew.error}
          onClose={() => setAdding(false)}
          onSave={(people) =>
            m.addCrew.mutate({ detail: d, people }, { onSuccess: () => setAdding(false) })
          }
        />
      ) : null}
      {signing ? (
        <SignDialog
          name={signing.personName}
          pending={m.sign.isPending}
          error={m.sign.error}
          onClose={() => setSigning(null)}
          onSign={(image) =>
            m.sign.mutate(
              { detail: d, crewId: signing.id, image },
              { onSuccess: () => setSigning(null) },
            )
          }
        />
      ) : null}
      {reviewing ? (
        <ReviewDialog
          pending={m.review.isPending}
          error={m.review.error}
          onClose={() => setReviewing(false)}
          onSave={(note) =>
            m.review.mutate({ detail: d, note }, { onSuccess: () => setReviewing(false) })
          }
        />
      ) : null}
    </>
  );
}
