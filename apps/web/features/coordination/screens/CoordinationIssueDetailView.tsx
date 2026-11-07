'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Card,
  DescriptionList,
  ItemHeader,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  buttonClassName,
} from '@archova/ui';
import { ChevronLeft } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { CoordinationIssuePriority } from '../data/api';
import {
  useBimModels,
  useCoordinationIssue,
  useCoordinationMutations,
  useFileUrl,
} from '../hooks/useCoordination';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  isActive,
  issueLabel,
  nextStatuses,
  priorityTone,
  statusTone,
} from '../lib/issues';

const PRIORITIES = Object.keys(PRIORITY_LABEL) as CoordinationIssuePriority[];

/** One coordination issue: its status moves, who it is waiting on, the drawing it was raised on, and the thread. */
export function CoordinationIssueDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = useCoordinationIssue(id);
  const models = useBimModels();
  const m = useCoordinationMutations();
  const [comment, setComment] = useState('');
  const d = q.data;
  const snapshot = useFileUrl(d?.issue.snapshotFileId ?? null);

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.coordination(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Coordination issues
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading the issue…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Coordination" title="Coordination issue" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this issue" />
      </>
    );
  }
  const i = d.issue;
  const overdue = isActive(i.status) && i.dueDate !== null && i.dueDate < todayIn(project.timezone);
  const change = (changes: Parameters<typeof m.change.mutate>[0]['changes']) =>
    m.change.mutate({ issueId: i.id, version: i.version, changes });
  const modelName = (models.data ?? []).find((x) => x.id === i.modelId)?.name;

  return (
    <>
      <p className="u-m-0" style={{ marginBottom: 'var(--space-4)' }}>
        {back}
      </p>
      <ItemHeader
        number={issueLabel(i.number)}
        title={i.title}
        status={<StatusPill tone={statusTone(i.status)}>{STATUS_LABEL[i.status]}</StatusPill>}
        due={i.dueDate ? `Due ${formatLocalDate(i.dueDate)}` : undefined}
        ballInCourt={
          isActive(i.status)
            ? `Waiting on: ${i.assigneeId ? dir.personName(i.assigneeId) : 'nobody yet'}`
            : undefined
        }
        meta={
          <>
            <StatusPill tone={priorityTone(i.priority)}>{PRIORITY_LABEL[i.priority]}</StatusPill>
            {overdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
          </>
        }
        actions={nextStatuses(i.status).map((s) => (
          <Button
            key={s}
            variant={s === 'resolved' ? 'primary' : 'secondary'}
            disabled={m.change.isPending}
            onClick={() => change({ status: s })}
          >
            {s === 'open' ? 'Reopen' : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
          </Button>
        ))}
      />
      <ErrorAlert error={m.change.error} title="We couldn't change this issue" />
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Description">
            <p className="u-m-0 u-prewrap">{i.description || 'No description.'}</p>
          </Card>
          <Card title={`Comments (${d.comments.length})`}>
            <div className="stack">
              {d.comments.length === 0 ? <p className="u-m-0">No comments yet.</p> : null}
              <ul aria-label="Comments" className="u-m-0">
                {d.comments.map((c) => (
                  <li key={c.id}>
                    <strong>{dir.personName(c.authorId)}</strong>
                    <span className="u-caption">
                      {' '}
                      · {formatInstant(c.createdAt, project.timezone)}
                    </span>
                    <br />
                    {c.body}
                  </li>
                ))}
              </ul>
              <Textarea
                label="Add a comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="u-row">
                <Button
                  disabled={!comment.trim() || m.comment.isPending}
                  onClick={() =>
                    m.comment.mutate(
                      { issueId: i.id, body: comment.trim() },
                      { onSuccess: () => setComment('') },
                    )
                  }
                >
                  {m.comment.isPending ? 'Adding…' : 'Add comment'}
                </Button>
              </div>
              <ErrorAlert error={m.comment.error} title="We couldn't add the comment" />
            </div>
          </Card>
        </div>
        <div className="stack-lg">
          <Card title="Details">
            <div className="stack">
              <Select
                label="Assigned to"
                value={i.assigneeId ?? ''}
                options={[
                  { value: '', label: 'Not assigned' },
                  ...dir.people.map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(e) => change({ assigneeId: e.target.value || null })}
              />
              <Select
                label="Priority"
                value={i.priority}
                options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                onChange={(e) => change({ priority: e.target.value as CoordinationIssuePriority })}
              />
              <TextField
                label="Due date"
                type="date"
                value={i.dueDate ?? ''}
                onChange={(e) => change({ dueDate: e.target.value || null })}
              />
              <DescriptionList
                items={[
                  { label: 'Location', value: i.location || '—' },
                  { label: 'Model', value: modelName ?? '—' },
                  {
                    label: 'Elements',
                    value: i.elementGuids.length ? i.elementGuids.join(', ') : '—',
                  },
                  { label: 'Raised', value: formatInstant(i.createdAt, project.timezone) },
                  {
                    label: 'Resolved',
                    value: i.resolvedAt ? formatInstant(i.resolvedAt, project.timezone) : '—',
                  },
                ]}
              />
            </div>
          </Card>
          <Card title="Drawing">
            {i.pin && i.sheetId ? (
              <div className="stack">
                {snapshot.data ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage URL
                  <img
                    src={snapshot.data}
                    alt="Snapshot of the drawing where this issue was raised"
                    style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }}
                  />
                ) : null}
                <p className="u-m-0 u-caption">
                  Pinned {Math.round(i.pin.x * 100)}% across, {Math.round(i.pin.y * 100)}% down.
                </p>
                <Link
                  className="link"
                  href={webRoutes.drawing(
                    org.orgSlug,
                    project.projectId,
                    i.sheetId,
                    i.pin.drawingRevisionId,
                  )}
                >
                  Open on the drawing
                </Link>
              </div>
            ) : (
              <p className="u-m-0 u-muted">Not raised from a drawing.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
