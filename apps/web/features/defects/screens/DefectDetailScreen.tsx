'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ActivityTimeline,
  Button,
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
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatInstant, todayIn } from '@/shared/lib/format';
import { MOCK_COMPANIES, MOCK_PEOPLE, companyName, personName } from '@/shared/mocks/directory';
import { locationPath } from '@/shared/mocks/locations';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DefectDue, DefectStatusPill, StageBadge } from '../components/DefectChips';
import { READY_NEEDS_PHOTO } from '../data/source';
import { useDefect, useDefectMutations } from '../hooks/useDefects';
import { canDefect } from '../lib/lifecycle';
import { PRIORITY_LABELS, STATUS_LABELS, formatDefectNumber, type Defect } from '../lib/types';

type Pending = 'ready' | 'close' | 'reject' | 'dispute' | 'void' | 'reassign' | null;

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
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'defect', id: defectId },
  });
  const defect = useDefect(defectId);
  if (defect.isPending) return <SkeletonRows label="Loading defect…" />;
  if (defect.isError)
    return <ErrorAlert error={defect.error} title="We couldn't open this defect" />;
  return <DefectView d={defect.data} />;
}

function DefectView({ d }: { d: Defect }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const m = useDefectMutations();
  const today = todayIn(project.timezone);
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [assign, setAssign] = useState({
    companyId: d.assigneeCompanyId,
    userId: '',
    dueDate: d.dueDate ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);

  const open = (p: Exclude<Pending, null>) => {
    setNote('');
    setPhotos([]);
    setProblem(null);
    setAssign({ companyId: d.assigneeCompanyId, userId: '', dueDate: d.dueDate ?? '' });
    setPending(p);
  };
  const done = { onSuccess: () => setPending(null) };
  const busy =
    m.markReady.isPending || m.close.isPending || m.withReason.isPending || m.reassign.isPending;
  const error = m.markReady.error ?? m.close.error ?? m.withReason.error ?? m.reassign.error;

  const confirm = () => {
    if (pending === 'ready') {
      if (READY_NEEDS_PHOTO && photos.length === 0)
        return setProblem('Add an “after” photo to show the fix.');
      m.markReady.mutate({ id: d.id, note, photoNames: photos }, done);
    } else if (pending === 'close') {
      m.close.mutate({ id: d.id, note, photoNames: photos }, done);
    } else if (pending === 'reject' || pending === 'dispute' || pending === 'void') {
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
      {d.status === 'open' ? (
        <Button onClick={() => open('ready')}>Mark ready for inspection</Button>
      ) : null}
      {d.status === 'ready_for_review' ? (
        <>
          <Button onClick={() => open('close')}>Close defect</Button>
          <Button variant="secondary" onClick={() => open('reject')}>
            Reject
          </Button>
        </>
      ) : null}
      {d.status === 'disputed' ? <Button onClick={() => open('reassign')}>Reassign</Button> : null}
      {d.status === 'open' ? (
        <>
          <Button variant="secondary" onClick={() => open('reassign')}>
            Reassign
          </Button>
          <Button variant="tertiary" onClick={() => open('dispute')}>
            Not ours
          </Button>
        </>
      ) : null}
      {canDefect(d.status, 'void') ? (
        <Button variant="tertiary" onClick={() => open('void')}>
          Void
        </Button>
      ) : null}
    </>
  );

  const photoName = (id: string) => d.photos.find((p) => p.id === id)?.name ?? id;
  const needsReason = pending === 'reject' || pending === 'dispute' || pending === 'void';
  const takesPhotos = pending === 'ready' || pending === 'close';

  return (
    <div className="stack-lg">
      <p className="u-m-0">
        <Link className="link" href={webRoutes.defects(org.orgSlug, project.projectId)}>
          Defects
        </Link>
      </p>
      <ItemHeader
        number={<span className="u-mono">{formatDefectNumber(d.number)}</span>}
        title={d.title}
        status={<DefectStatusPill status={d.status} />}
        ballInCourt={`Assigned to: ${companyName(d.assigneeCompanyId)}${d.assigneeUserId ? ` · ${personName(d.assigneeUserId)}` : ''}`}
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
      <PreviewDataNotice tool="Defects" />
      <div className="detail-grid">
        <section className="stack" aria-labelledby="defect-details">
          <h2 id="defect-details" className="panel-heading">
            Details
          </h2>
          {d.description ? <p className="u-m-0 u-prewrap">{d.description}</p> : null}
          <DescriptionList
            items={[
              { label: 'Location', value: locationPath(d.locationId) ?? '—' },
              {
                label: 'Drawing',
                value: d.drawing ? (
                  <Link
                    className="link"
                    href={webRoutes.drawing(
                      org.orgSlug,
                      project.projectId,
                      d.drawing.sheetId,
                      d.drawing.revisionId,
                    )}
                  >
                    {d.drawing.label}
                  </Link>
                ) : (
                  'No pin yet'
                ),
              },
              { label: 'Trade', value: d.trade || '—' },
              { label: 'Priority', value: PRIORITY_LABELS[d.priority] },
              {
                label: 'Raised by',
                value: `${d.raisedBy}, ${formatInstant(d.createdAt, project.timezone)}`,
              },
            ]}
          />
          <h3 className="panel-subheading">Photos</h3>
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
        </section>
        <section className="stack" aria-labelledby="defect-history">
          <h2 id="defect-history" className="panel-heading">
            History
          </h2>
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
        </section>
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
                options={MOCK_COMPANIES.filter((c) => c.role === 'subcontractor').map((c) => ({
                  value: c.id,
                  label: `${c.name} · ${c.trade}`,
                }))}
                onChange={(e) => setAssign({ ...assign, companyId: e.target.value, userId: '' })}
              />
              <Select
                label="Person (optional)"
                value={assign.userId}
                placeholder="Anyone at the company"
                options={MOCK_PEOPLE.filter((p) => p.companyId === assign.companyId).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
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
                onChange={(e) => setPhotos([...(e.target.files ?? [])].map((f) => f.name))}
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
