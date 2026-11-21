'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DocumentReview, DocumentReviewStep } from '@archova/contracts';
import { endOfLocalDay } from '@archova/time';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { projectMembers } from '@/shared/lib/people';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import {
  useAddComment,
  useCancelReview,
  useDecideStep,
  useDocumentComments,
  useDocumentReview,
  useReassignStep,
  useResolveComment,
  useReviewSuggestions,
  useStartReview,
} from '../hooks/useReviews';
import type { ProjectDocument } from '../lib/types';

const STEP_LABELS: Record<DocumentReviewStep['status'], string> = {
  waiting: 'Waiting for earlier steps',
  pending: 'Needs a decision',
  approved: 'Approved',
  approved_with_comments: 'Approved with comments',
  rejected: 'Rejected',
  skipped: 'Skipped',
};
const STEP_TONES: Record<DocumentReviewStep['status'], StatusTone> = {
  waiting: 'neutral',
  pending: 'info',
  approved: 'success',
  approved_with_comments: 'warning',
  rejected: 'danger',
  skipped: 'neutral',
};
export const REVIEW_STATUS_LABELS: Record<DocumentReview['status'], string> = {
  open: 'Out for review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** "2 days late", shown on every review that has passed its due date (or the 5 day default). */
export function LateBadge({ days }: { days: number }) {
  return days > 0 ? (
    <StatusPill tone="danger">{`${days} day${days === 1 ? '' : 's'} late`}</StatusPill>
  ) : null;
}

type Decision = 'approved' | 'approved_with_comments' | 'rejected';

/** Review matrix and comment threads for the document selected on the register (document control). */
export function ReviewPanel({ document }: { document: ProjectDocument }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const [tab, setTab] = useState('matrix');
  const review = useDocumentReview(project.projectId, document.id);
  const comments = useDocumentComments(project.projectId, document.id);
  const openCount = review.data?.openComments ?? 0;
  const [starting, setStarting] = useState(false);
  const [deciding, setDeciding] = useState<{ step: DocumentReviewStep; decision: Decision } | null>(
    null,
  );
  const [reassigning, setReassigning] = useState<DocumentReviewStep | null>(null);
  const [note, setNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const cancel = useCancelReview(project.projectId);
  const decide = useDecideStep(project.projectId);
  const reassign = useReassignStep(project.projectId);
  const members = useQuery({
    queryKey: ['project-members', org.orgId, project.projectId],
    queryFn: () => projectMembers(org.orgId, project.projectId),
    staleTime: 60_000,
  });

  const current = review.data?.current ?? null;
  const open = current?.status === 'open' ? current : null;

  const columns: DataTableColumn<DocumentReviewStep>[] = [
    { id: 'order', header: 'Step', cell: (s) => s.order, sortValue: (s) => s.order },
    {
      id: 'person',
      header: 'Person',
      rowHeader: true,
      cell: (s) =>
        s.userId === actor.id ? `${s.userName ?? 'You'} (you)` : (s.userName ?? 'Project member'),
    },
    { id: 'role', header: 'Role', cell: (s) => (s.role === 'approver' ? 'Approver' : 'Reviewer') },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusPill tone={STEP_TONES[s.status]}>{STEP_LABELS[s.status]}</StatusPill>,
    },
    {
      id: 'decided',
      header: 'Decided',
      cell: (s) => (
        <span>
          {s.decidedAt ? formatInstant(s.decidedAt, project.timezone) : '—'}
          {s.decisionNote ? <span className="u-caption"> · {s.decisionNote}</span> : null}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      cell: (s) => (
        <div className="row-actions">
          {open && s.userId === actor.id && s.status === 'pending' ? (
            <>
              <Button size="sm" onClick={() => setDeciding({ step: s, decision: 'approved' })}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDeciding({ step: s, decision: 'approved_with_comments' })}
              >
                Approve with comments
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeciding({ step: s, decision: 'rejected' })}
              >
                Reject
              </Button>
            </>
          ) : null}
          {open && (s.status === 'pending' || s.status === 'waiting') ? (
            <Button size="sm" variant="tertiary" onClick={() => setReassigning(s)}>
              Reassign
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby="doc-review" className="ac-card stack">
      <div className="row-actions">
        <h2 id="doc-review" className="panel-heading">
          Review and comments on {document.title}
        </h2>
        {current ? (
          <StatusPill
            tone={
              current.status === 'approved'
                ? 'success'
                : current.status === 'rejected'
                  ? 'danger'
                  : current.status === 'open'
                    ? 'info'
                    : 'neutral'
            }
          >
            {REVIEW_STATUS_LABELS[current.status]}
          </StatusPill>
        ) : null}
        {open ? <LateBadge days={open.overdueDays} /> : null}
      </div>
      <ErrorAlert error={review.error ?? comments.error} title="We couldn't load the review" />
      <ErrorAlert
        error={cancel.error ?? decide.error ?? reassign.error}
        title="We couldn't update the review"
      />
      <Tabs
        label="Review and comments"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'matrix', label: 'Review matrix' },
          { id: 'comments', label: 'Comments', count: openCount },
        ]}
      >
        {tab === 'matrix' ? (
          review.isPending ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="stack">
              {open?.stale ? (
                <p role="status" className="u-caption">
                  A newer revision was added after this round started. The people below reviewed an
                  earlier one; cancel and start again to review the latest.
                </p>
              ) : null}
              {current ? (
                <>
                  <p className="u-caption">
                    {current.mode === 'sequential'
                      ? 'Steps run in order; each step opens when the one before is decided.'
                      : 'Everyone can decide at once.'}
                    {current.dueAt ? ` Due ${formatInstant(current.dueAt, project.timezone)}.` : ''}
                    {current.note ? ` ${current.note}` : ''}
                  </p>
                  <DataTable
                    caption="Review matrix"
                    columns={columns}
                    rows={current.steps}
                    getRowId={(s) => s.id}
                    defaultSort={{ columnId: 'order', direction: 'asc' }}
                  />
                </>
              ) : (
                <EmptyState
                  title="Not out for review"
                  description="Choose who needs to review or approve this document, and in what order."
                />
              )}
              <div className="row-actions">
                {open ? (
                  <Button
                    variant="secondary"
                    loading={cancel.isPending}
                    onClick={() => cancel.mutate(document.id)}
                  >
                    Cancel review
                  </Button>
                ) : (
                  <Button onClick={() => setStarting(true)}>
                    {current ? 'Start a new review' : 'Send for review'}
                  </Button>
                )}
              </div>
              {(review.data?.history.length ?? 0) > 0 ? (
                <details>
                  <summary>Earlier rounds ({review.data?.history.length})</summary>
                  <ul className="plain-list">
                    {review.data?.history.map((h) => (
                      <li key={h.id} className="plain-list__item">
                        <strong>{REVIEW_STATUS_LABELS[h.status]}</strong>{' '}
                        <span className="u-caption">
                          {formatInstant(h.createdAt, project.timezone)} ·{' '}
                          {h.steps
                            .map((s) => `${s.userName ?? 'Member'}: ${STEP_LABELS[s.status]}`)
                            .join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )
        ) : (
          <CommentThreads document={document} />
        )}
      </Tabs>

      <StartReviewDialog document={document} open={starting} onClose={() => setStarting(false)} />

      <Dialog
        open={deciding !== null}
        onClose={() => {
          setDeciding(null);
          setNote('');
        }}
        title={
          deciding?.decision === 'rejected'
            ? 'Reject this document?'
            : deciding?.decision === 'approved_with_comments'
              ? 'Approve with comments'
              : 'Approve this document'
        }
        description={
          deciding?.decision === 'rejected'
            ? 'The round ends and the document goes back to draft. Say what needs to change.'
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeciding(null);
                setNote('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === 'rejected' ? 'danger' : 'primary'}
              loading={decide.isPending}
              disabled={deciding?.decision !== 'approved' && !note.trim()}
              onClick={() =>
                deciding &&
                decide.mutate(
                  {
                    documentId: document.id,
                    stepId: deciding.step.id,
                    decision: deciding.decision,
                    note: note.trim() || null,
                  },
                  {
                    onSuccess: () => {
                      setDeciding(null);
                      setNote('');
                    },
                  },
                )
              }
            >
              Confirm
            </Button>
          </>
        }
      >
        <Textarea
          label={deciding?.decision === 'approved' ? 'Note (optional)' : 'Note'}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>

      <Dialog
        open={reassigning !== null}
        onClose={() => setReassigning(null)}
        title="Reassign this step"
        description="The new person is told the step is theirs."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReassigning(null)}>
              Cancel
            </Button>
            <Button
              loading={reassign.isPending}
              disabled={!reassignTo}
              onClick={() =>
                reassigning &&
                reassign.mutate(
                  { documentId: document.id, stepId: reassigning.id, userId: reassignTo },
                  {
                    onSuccess: () => {
                      setReassigning(null);
                      setReassignTo('');
                    },
                  },
                )
              }
            >
              Reassign
            </Button>
          </>
        }
      >
        <Select
          label="Person"
          placeholder="Choose a person"
          value={reassignTo}
          onChange={(e) => setReassignTo(e.target.value)}
          options={(members.data ?? [])
            .filter((m) => !current?.steps.some((s) => s.userId === m.id))
            .map((m) => ({ value: m.id, label: m.name }))}
        />
      </Dialog>
    </section>
  );
}

interface DraftStep {
  userId: string;
  role: 'reviewer' | 'approver';
  order: number;
}

function StartReviewDialog({
  document,
  open,
  onClose,
}: {
  document: ProjectDocument;
  open: boolean;
  onClose: () => void;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const [mode, setMode] = useState<'sequential' | 'parallel'>('sequential');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const start = useStartReview(project.projectId);
  const suggestions = useReviewSuggestions(project.projectId, document.id, open);
  const members = useQuery({
    queryKey: ['project-members', org.orgId, project.projectId],
    queryFn: () => projectMembers(org.orgId, project.projectId),
    staleTime: 60_000,
  });
  const nameOf = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.id, m.name] as const)),
    [members.data],
  );
  const chosen = new Set(steps.map((s) => s.userId));
  const add = (userId: string, role: DraftStep['role']) =>
    setSteps((cur) =>
      cur.some((s) => s.userId === userId)
        ? cur
        : [...cur, { userId, role, order: role === 'approver' ? cur.length + 1 : 1 }],
    );
  const reset = () => {
    setSteps([]);
    setDue('');
    setNote('');
    setMode('sequential');
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`Send ${document.title} for review`}
      description="Pick who reviews and approves it. The document moves to For review until everyone has decided."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            loading={start.isPending}
            disabled={steps.length === 0}
            onClick={() =>
              start.mutate(
                {
                  documentId: document.id,
                  input: {
                    mode,
                    dueAt: due ? endOfLocalDay(due, project.timezone).toISOString() : null,
                    note: note.trim() || null,
                    steps,
                  },
                },
                {
                  onSuccess: () => {
                    reset();
                    onClose();
                  },
                },
              )
            }
          >
            Send for review
          </Button>
        </>
      }
    >
      <Select
        label="How it runs"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'sequential' | 'parallel')}
        options={[
          { value: 'sequential', label: 'In order (step by step)' },
          { value: 'parallel', label: 'Everyone at once' },
        ]}
      />
      {(suggestions.data?.length ?? 0) > 0 ? (
        <div className="stack-sm">
          <p className="u-caption">
            Nova suggests people who reviewed this type of document before:
          </p>
          <div className="row-actions">
            {suggestions.data?.map((s) => (
              <Button
                key={s.userId}
                size="sm"
                variant="secondary"
                disabled={chosen.has(s.userId)}
                onClick={() => add(s.userId, s.role)}
              >
                {s.userName ?? 'Project member'} ({s.role})
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <Select
        label="Add a person"
        placeholder="Choose a person"
        value=""
        onChange={(e) => e.target.value && add(e.target.value, 'reviewer')}
        options={(members.data ?? [])
          .filter((m) => !chosen.has(m.id))
          .map((m) => ({ value: m.id, label: m.name }))}
      />
      {steps.length > 0 ? (
        <ul className="plain-list">
          {steps.map((s, i) => (
            <li key={s.userId} className="plain-list__item">
              <div className="row-actions">
                <strong>{nameOf.get(s.userId) ?? 'Project member'}</strong>
                <Select
                  label="Role"
                  value={s.role}
                  onChange={(e) =>
                    setSteps(
                      steps.map((x, j) =>
                        j === i ? { ...x, role: e.target.value as DraftStep['role'] } : x,
                      ),
                    )
                  }
                  options={[
                    { value: 'reviewer', label: 'Reviewer' },
                    { value: 'approver', label: 'Approver' },
                  ]}
                />
                {mode === 'sequential' ? (
                  <TextField
                    label="Step"
                    type="number"
                    min={1}
                    max={50}
                    value={String(s.order)}
                    onChange={(e) =>
                      setSteps(
                        steps.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                order: Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="tertiary"
                  aria-label={`Remove ${nameOf.get(s.userId) ?? 'person'}`}
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <TextField
        label="Due date (optional)"
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        hint="Nova flags the review once it is late. With no date, 5 days after a step opens."
      />
      <Textarea
        label="Note (optional)"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <ErrorAlert error={start.error} />
    </Dialog>
  );
}

function CommentThreads({ document }: { document: ProjectDocument }) {
  const project = useCurrentProject();
  const comments = useDocumentComments(project.projectId, document.id);
  const add = useAddComment(project.projectId);
  const resolve = useResolveComment(project.projectId);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const threads = (comments.data?.data ?? []).filter(
    (t) => filter === 'all' || t.root.status === 'open',
  );

  if (comments.isPending) return <SkeletonRows rows={3} />;
  return (
    <div className="stack">
      <ErrorAlert error={add.error ?? resolve.error} title="We couldn't update the comments" />
      <div className="row-actions">
        <Button
          size="sm"
          variant={filter === 'all' ? 'primary' : 'secondary'}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filter === 'open' ? 'primary' : 'secondary'}
          aria-pressed={filter === 'open'}
          onClick={() => setFilter('open')}
        >
          Open only
        </Button>
      </div>
      {threads.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'No open comments' : 'No comments yet'}
          description="Start a thread below. Each thread can be replied to and resolved."
        />
      ) : (
        <ul className="plain-list">
          {threads.map((t) => (
            <li key={t.root.id} className="plain-list__item stack-sm">
              <div className="row-actions">
                <StatusPill tone={t.root.status === 'open' ? 'warning' : 'success'}>
                  {t.root.status === 'open' ? 'Open' : 'Resolved'}
                </StatusPill>
                <strong>{t.root.authorName ?? 'Project member'}</strong>
                <span className="u-caption">
                  {formatInstant(t.root.createdAt, project.timezone)}
                </span>
              </div>
              <p>{t.root.body}</p>
              {t.root.status === 'resolved' ? (
                <p className="u-caption">
                  Resolved by {t.root.resolvedByName ?? 'a project member'}
                  {t.root.resolutionNote ? `: ${t.root.resolutionNote}` : ''}
                </p>
              ) : null}
              {t.replies.map((r) => (
                <div key={r.id} className="stack-sm">
                  <span className="u-caption">
                    {r.authorName ?? 'Project member'} ·{' '}
                    {formatInstant(r.createdAt, project.timezone)}
                  </span>
                  <p>{r.body}</p>
                </div>
              ))}
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => setReplyTo(replyTo === t.root.id ? null : t.root.id)}
                >
                  Reply
                </Button>
                <Button
                  size="sm"
                  variant="tertiary"
                  loading={resolve.isPending && resolve.variables?.commentId === t.root.id}
                  onClick={() =>
                    resolve.mutate({
                      documentId: document.id,
                      commentId: t.root.id,
                      resolved: t.root.status === 'open',
                    })
                  }
                >
                  {t.root.status === 'open' ? 'Resolve' : 'Reopen'}
                </Button>
              </div>
              {replyTo === t.root.id ? (
                <div className="stack-sm">
                  <Textarea
                    label="Reply"
                    rows={2}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="row-actions">
                    <Button
                      size="sm"
                      loading={add.isPending}
                      disabled={!reply.trim()}
                      onClick={() =>
                        add.mutate(
                          { documentId: document.id, body: reply.trim(), parentId: t.root.id },
                          {
                            onSuccess: () => {
                              setReply('');
                              setReplyTo(null);
                            },
                          },
                        )
                      }
                    >
                      Post reply
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Textarea
        label="New comment"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <Button
          loading={add.isPending && replyTo === null}
          disabled={!text.trim()}
          onClick={() =>
            add.mutate(
              { documentId: document.id, body: text.trim() },
              { onSuccess: () => setText('') },
            )
          }
        >
          Add comment
        </Button>
      </div>
    </div>
  );
}
