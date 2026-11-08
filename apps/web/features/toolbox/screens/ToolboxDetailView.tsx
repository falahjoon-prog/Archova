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
import { ChevronLeft, Plus, ToolboxIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useTalkDetail, useToolboxMutations } from '../hooks/useToolbox';
import { CATEGORY_LABELS, REPEAT_LABELS, STATUS_LABELS, type Attendee } from '../lib/types';
import { AddPeopleDialog, SignDialog } from './dialogs';
import { RowMenu } from './RowMenu';

export function ToolboxDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = useTalkDetail(id);
  const m = useToolboxMutations();
  const [adding, setAdding] = useState(false);
  const [signing, setSigning] = useState<Attendee | null>(null);
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'toolbox', id } });
  const d = q.data;
  const tz = project.timezone;

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.toolboxTalks(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Toolbox talks
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading toolbox talk…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="Toolbox talk" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this talk" />
      </>
    );
  }
  const t = d.talk;
  const isOpen = t.status === 'open';
  const editable = isOpen && d.canEdit;
  const flagged = d.attendees.filter((a) => a.repeatFlags.length > 0);

  const columns: DataTableColumn<Attendee>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (a) => a.personName,
      cell: (a) => a.personName,
    },
    {
      id: 'company',
      header: 'Company',
      sortValue: (a) => dir.companyName(a.companyId),
      cell: (a) => (a.companyId ? dir.companyName(a.companyId) : '—'),
    },
    {
      id: 'signature',
      header: 'Signature',
      sortValue: (a) => a.signedAt ?? '',
      cell: (a) =>
        a.signedAt ? (
          <>
            <StatusPill tone="success">Signed</StatusPill>{' '}
            <span className="u-muted">{formatInstant(a.signedAt, tz)}</span>
          </>
        ) : (
          <StatusPill tone="warning">Not signed</StatusPill>
        ),
    },
    {
      id: 'flag',
      header: 'Check',
      cell: (a) =>
        a.repeatFlags.length ? (
          <StatusPill tone="warning">
            {a.repeatFlags.map((r) => REPEAT_LABELS[r]).join('; ')}
          </StatusPill>
        ) : (
          '—'
        ),
    },
    {
      id: 'menu',
      header: <span className="sr-only">Actions</span>,
      cell: (a) =>
        editable ? (
          <RowMenu
            label={`Actions for ${a.personName}`}
            items={[
              ...(a.signedAt
                ? [
                    {
                      label: 'Clear signature',
                      onSelect: () => m.clearSignature.mutate({ detail: d, attendeeId: a.id }),
                    },
                  ]
                : [{ label: 'Sign…', onSelect: () => setSigning(a) }]),
              {
                label: 'Remove from talk',
                disabled: Boolean(a.signedAt),
                onSelect: () => m.removeAttendee.mutate({ detail: d, attendeeId: a.id }),
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
        number={t.numberLabel}
        title={t.title}
        status={
          <StatusPill tone={isOpen ? 'info' : 'success'}>{STATUS_LABELS[t.status]}</StatusPill>
        }
        actions={
          d.canEdit ? (
            isOpen ? (
              <Button
                disabled={d.closeBlockers.length > 0 || m.transition.isPending}
                onClick={() => m.transition.mutate({ detail: d, action: 'close' })}
              >
                Close talk
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={m.transition.isPending}
                onClick={() => m.transition.mutate({ detail: d, action: 'reopen' })}
              >
                Reopen
              </Button>
            )
          ) : null
        }
      />
      <ErrorAlert error={m.transition.error} title="We couldn't change the talk" />
      {isOpen && d.closeBlockers.length ? <Alert tone="info">{d.closeBlockers[0]}</Alert> : null}
      {flagged.length ? (
        <Alert tone="warning" title="Check these signatures">
          {flagged.map((a) => a.personName).join(', ')}: a signature image repeats. A hand-drawn
          signature is never identical twice, so someone may have signed for another person or
          pasted an old one. This is a prompt to look, not a finding.
        </Alert>
      ) : null}
      <Card title="Details">
        <DescriptionList
          items={[
            { label: 'When', value: formatInstant(t.heldAt, tz) },
            { label: 'Presented by', value: t.presenterName },
            { label: 'Location', value: t.location ?? '—' },
            {
              label: 'Topic',
              value: d.topic
                ? `${d.topic.title} (${CATEGORY_LABELS[d.topic.category]})`
                : 'Not from the library',
            },
          ]}
        />
      </Card>
      <Card
        title="Attendance"
        actions={
          editable ? (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add people
            </Button>
          ) : null
        }
      >
        <ErrorAlert
          error={m.clearSignature.error ?? m.removeAttendee.error}
          title="We couldn't update the grid"
        />
        {d.attendees.length === 0 ? (
          <EmptyState
            icon={ToolboxIcon}
            title="Nobody on the grid yet"
            description="Add the people who attended, then each one signs."
          />
        ) : (
          <DataTable
            caption="Attendance"
            columns={columns}
            rows={d.attendees}
            getRowId={(a) => a.id}
          />
        )}
      </Card>
      {adding ? (
        <AddPeopleDialog
          companies={dir.companies.map((c) => ({ id: c.id, name: c.name }))}
          pending={m.addAttendees.isPending}
          error={m.addAttendees.error}
          onClose={() => setAdding(false)}
          onSave={(people) =>
            m.addAttendees.mutate({ detail: d, people }, { onSuccess: () => setAdding(false) })
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
              { detail: d, attendeeId: signing.id, image },
              { onSuccess: () => setSigning(null) },
            )
          }
        />
      ) : null}
    </>
  );
}
