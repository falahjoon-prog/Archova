'use client';

import Link from 'next/link';
import { RecordRecent } from '@/features/recents';
import { useState } from 'react';
import {
  ActivityTimeline,
  Button,
  Card,
  DescriptionList,
  Dialog,
  ItemHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { useAskNova, usePublishAssistantScope } from '@/features/assistant';
import { useSheetPicker } from '@/features/drawings';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant, todayIn } from '@/shared/lib/format';
import { locationPath } from '@/shared/mocks/locations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { DefectDue, DefectStatusPill, StageBadge } from '../components/DefectChips';
import { READY_NEEDS_PHOTO } from '../data/source';
import { useDefect, useDefectMutations, useDefectsSource } from '../hooks/useDefects';
import { defectCan } from '../lib/lifecycle';
import { PRIORITY_LABELS, STATUS_LABELS, formatDefectNumber, type Defect } from '../lib/types';

type Pending = 'ready' | 'close' | 'reject' | 'dispute' | 'void' | 'reassign' | 'reopen' | null;

const DIALOG: Record<
  Exclude<Pending, null>,
  { title: string; description: string; confirm: string }
> = {
  ready: {
    title: 'Mark ready for inspection',
    description: 'Add an “after” photo so the builder can check the fix.',
    confirm: 'Mark ready',
  },
  close: {
    title: 'Close defect',
    description: 'Closing confirms the fix was inspected. Add a photo as evidence if you have one.',
    confirm: 'Close defect',
  },
  reopen: {
    title: 'Reopen',
    description: 'The defect goes back to the company as open. They see your reason.',
    confirm: 'Reopen',
  },
  reject: {
    title: 'Reject the fix',
    description: 'The defect goes back to the company as open. They see your reason.',
    confirm: 'Reject',
  },
  dispute: {
    title: 'Not ours',
    description: 'Tell the builder why this belongs to someone else. They will reassign it.',
    confirm: 'Send to builder',
  },
  void: {
    title: 'Void defect',
    description: 'A void defect stays in the register with your reason.',
    confirm: 'Void defect',
  },
  reassign: {
    title: 'Reassign defect',
    description: 'The new company is notified and the defect reopens with them.',
    confirm: 'Reassign',
  },
};

/** One defect (F1.8 steps 3–4): fix evidence, close or reject, dispute, reassign, void. */
export function DefectDetailScreen({ defectId }: { defectId: string }) {
  const project = useCurrentProject();
  const defect = useDefect(defectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: {
      type: 'defect',
      id: defectId,
      ...(defect.data ? { label: formatDefectNumber(defect.data.number) } : {}),
    },
  });
  if (defect.isPending) return <SkeletonRows label="Loading defect…" />;
  if (defect.isError)
    return <ErrorAlert error={defect.error} title="We couldn't open this defect" />;
  return <DefectView d={defect.data} />;
}

function DefectView({ d }: { d: Defect }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const m = useDefectMutations();
  const { live } = useDefectsSource();
  const dir = useProjectDirectory();
  const sheets = useSheetPicker(project.projectId);
  const askNova = useAskNova();
  const today = todayIn(project.timezone);
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [assign, setAssign] = useState({
    companyId: d.assigneeCompanyId ?? '',
    userId: '',
    dueDate: d.dueDate ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);

  const open = (p: Exclude<Pending, null>) => {
    setNote('');
    setPhotos([]);
    setProblem(null);
    setAssign({ companyId: d.assigneeCompanyId ?? '', userId: '', dueDate: d.dueDate ?? '' });
    setPending(p);
  };
  const done = { onSuccess: () => setPending(null) };
  const busy =
    m.markReady.isPending || m.close.isPending || m.withReason.isPending || m.reassign.isPending;
  const error =
    m.markReady.error ?? m.close.error ?? m.withReason.error ?? m.reassign.error ?? m.issue.error;

  const confirm = () => {
    if (pending === 'ready') {
      if (READY_NEEDS_PHOTO && photos.length === 0)
        return setProblem('Add an “after” photo to show the fix.');
      m.markReady.mutate({ id: d.id, note, photos }, done);
    } else if (pending === 'close') {
      m.close.mutate({ id: d.id, note, photos }, done);
    } else if (
      pending === 'reject' ||
      pending === 'dispute' ||
      pending === 'void' ||
      pending === 'reopen'
    ) {
      if (!note.trim()) return setProblem('Give a reason.');
      m.withReason.mutate({ id: d.id, action: pending, reason: note }, done);
    } else if (pending === 'reassign') {
      m.reassign.mutate(
        {
          id: d.id,
          companyId: assign.companyId,
          userId: assign.userId || null,
          dueDate: assign.dueDate || null,
        },
        done,
      );
    }
  };

  const actions = (
    <>
      {defectCan(d, 'issue') && d.assigneeCompanyId ? (
        <Button disabled={m.issue.isPending} onClick={() => m.issue.mutate(d.id)}>
          Send to company
        </Button>
      ) : null}
      {defectCan(d, 'ready') ? (
        <Button onClick={() => open('ready')}>Mark ready for inspection</Button>
      ) : null}
      {defectCan(d, 'close') ? (
        <>
          <Button onClick={() => open('close')}>Close defect</Button>
          {defectCan(d, 'reject') ? (
            <Button variant="secondary" onClick={() => open('reject')}>
              Reject
            </Button>
          ) : null}
        </>
      ) : null}
      {defectCan(d, 'reopen') ? (
        <Button variant="secondary" onClick={() => open('reopen')}>
          Reopen
        </Button>
      ) : null}
      {defectCan(d, 'reassign') ? (
        <Button
          variant={d.status === 'disputed' ? 'primary' : 'secondary'}
          onClick={() => open('reassign')}
        >
          Reassign
        </Button>
      ) : null}
      {defectCan(d, 'dispute') ? (
        <Button variant="tertiary" onClick={() => open('dispute')}>
          Not ours
        </Button>
      ) : null}
      {defectCan(d, 'void') ? (
        <Button variant="tertiary" onClick={() => open('void')}>
          Void
        </Button>
      ) : null}
      <Button variant="tertiary" onClick={askNova}>
        Ask Nova about this
      </Button>
    </>
  );

  // The API stores the revision; the sheet to link to comes from the register.
  const pinned = d.drawing;
  const sheet =
    pinned && !pinned.sheetId
      ? sheets.options.find((o) => o.revisionId === pinned.revisionId)
      : null;
  const drawing = pinned
    ? {
        ...pinned,
        sheetId: pinned.sheetId || sheet?.sheetId || '',
        label: sheet?.label ?? pinned.label,
      }
    : null;

  const personOrDash = (id: string | null) => (id ? dir.personName(id) : '—');
  const photoName = (id: string) => d.photos.find((p) => p.id === id)?.name ?? id;
  const needsReason =
    pending === 'reject' || pending === 'dispute' || pending === 'void' || pending === 'reopen';
  const takesPhotos = pending === 'ready' || pending === 'close';

  return (
    <div className="stack-lg">
      <RecordRecent
        entityType="defect"
        entityId={d.id}
        projectId={project.projectId}
        title={`${formatDefectNumber(d.number)} ${d.title}`}
      />
      <p className="u-m-0">
        <Link className="link" href={webRoutes.defects(org.orgSlug, project.projectId)}>
          Defects
        </Link>
      </p>
      <ItemHeader
        number={<span className="u-mono">{formatDefectNumber(d.number)}</span>}
        title={d.title}
        status={<DefectStatusPill status={d.status} />}
        ballInCourt={`Assigned to: ${d.assigneeCompanyId ? (d.assigneeCompanyId === project.companyId ? 'your company' : dir.companyName(d.assigneeCompanyId)) : 'no company yet'}${d.assigneeUserId ? ` · ${dir.personName(d.assigneeUserId)}` : ''}`}
        due={<DefectDue defect={d} today={today} />}
        meta={
          <>
            <StageBadge stage={d.stage} />
            {d.priority === 'high' || d.priority === 'critical' ? (
              <StatusPill tone="danger">{PRIORITY_LABELS[d.priority]} priority</StatusPill>
            ) : null}
            {d.source === 'certifier' ? (
              <StatusPill tone="info">Raised by certifier</StatusPill>
            ) : null}
          </>
        }
        actions={actions}
      />
      {live ? null : <PreviewDataNotice tool="Defects" />}
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Details">
            <div className="stack">
              {d.description ? <p className="u-m-0 u-prewrap">{d.description}</p> : null}
              <DescriptionList
                items={[
                  ...(live
                    ? []
                    : [{ label: 'Location', value: locationPath(d.locationId) ?? '—' }]),
                  {
                    label: 'Drawing',
                    value: drawing ? (
                      drawing.sheetId ? (
                        <Link
                          className="link"
                          href={webRoutes.drawing(
                            org.orgSlug,
                            project.projectId,
                            drawing.sheetId,
                            drawing.revisionId,
                          )}
                        >
                          {drawing.label}
                        </Link>
                      ) : (
                        drawing.label
                      )
                    ) : (
                      'No pin yet'
                    ),
                  },
                  { label: 'Trade', value: d.trade || '—' },
                  { label: 'Punch item manager', value: personOrDash(d.managerUserId) },
                  { label: 'Final approver', value: personOrDash(d.finalApproverUserId) },
                  {
                    label: 'Assignees',
                    value: d.assigneeUserIds.length
                      ? d.assigneeUserIds.map((u) => dir.personName(u)).join(', ')
                      : '—',
                  },
                  {
                    label: 'Distribution',
                    value: d.distributionUserIds.length
                      ? d.distributionUserIds.map((u) => dir.personName(u)).join(', ')
                      : '—',
                  },
                  { label: 'Priority', value: PRIORITY_LABELS[d.priority] },
                  {
                    label: 'Raised by',
                    value: `${d.raisedBy}, ${formatInstant(d.createdAt, project.timezone)}`,
                  },
                ]}
              />
            </div>
          </Card>
          <Card title="Photos">
            {d.photos.length ? (
              <ul className="photo-list plain-list" aria-label="Photos">
                {d.photos.map((p) => (
                  <li key={p.id} className="photo-chip">
                    <StatusPill tone={p.kind === 'before' ? 'neutral' : 'success'}>
                      {p.kind === 'before' ? 'Before' : p.kind === 'after' ? 'After' : 'Close-out'}
                    </StatusPill>
                    {p.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="u-muted u-m-0">No photos.</p>
            )}
          </Card>
        </div>
        <Card title="History">
          <ActivityTimeline
            label="Defect history"
            entries={d.events.map((e) => ({
              id: e.id,
              actor: e.by,
              action: e.fromStatus
                ? `moved it to ${STATUS_LABELS[e.toStatus]}`
                : 'raised the defect',
              ...(e.fromStatus
                ? {
                    change: {
                      before: STATUS_LABELS[e.fromStatus],
                      after: STATUS_LABELS[e.toStatus],
                    },
                  }
                : {}),
              detail:
                e.note || e.photoIds.length ? (
                  <>
                    {e.note ? <p className="u-m-0">{e.note}</p> : null}
                    {e.photoIds.length ? (
                      <p className="u-m-0 u-caption">
                        Photos: {e.photoIds.map(photoName).join(', ')}
                      </p>
                    ) : null}
                  </>
                ) : undefined,
              at: formatInstant(e.at, project.timezone),
              atIso: e.at,
            }))}
          />
        </Card>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? `${DIALOG[pending].title} ${formatDefectNumber(d.number)}` : ''}
        description={pending ? DIALOG[pending].description : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending === 'void' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={confirm}
            >
              {pending ? DIALOG[pending].confirm : ''}
            </Button>
          </>
        }
      >
        <div className="stack">
          {pending === 'reassign' ? (
            <>
              <Select
                label="Company"
                value={assign.companyId}
                options={dir.companies
                  .filter((c) => c.isSubcontractor && dir.onProject(c.id))
                  .map((c) => ({ value: c.id, label: `${c.name} · ${c.trades.join(', ')}` }))}
                onChange={(e) => setAssign({ ...assign, companyId: e.target.value, userId: '' })}
              />
              <Select
                label="Person (optional)"
                value={assign.userId}
                placeholder="Anyone at the company"
                options={dir.people
                  .filter((p) => p.companyId === assign.companyId)
                  .map((p) => ({ value: p.id, label: p.name }))}
                onChange={(e) => setAssign({ ...assign, userId: e.target.value })}
              />
              <TextField
                label="Due date"
                type="date"
                value={assign.dueDate}
                onChange={(e) => setAssign({ ...assign, dueDate: e.target.value })}
              />
            </>
          ) : null}
          {takesPhotos ? (
            <div className="stack">
              <label className="ac-field__label" htmlFor="defect-evidence">
                {pending === 'ready' ? 'After photos' : 'Close-out photos (optional)'}
              </label>
              <input
                id="defect-evidence"
                className="file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setPhotos([...(e.target.files ?? [])])}
              />
            </div>
          ) : null}
          {pending && pending !== 'reassign' ? (
            <Textarea
              label={needsReason ? 'Reason' : 'Note (optional)'}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : null}
          {problem ? (
            <p className="ac-field__error" role="alert">
              {problem}
            </p>
          ) : null}
          <ErrorAlert error={error} title="That didn't work" />
        </div>
      </Dialog>
    </div>
  );
}
