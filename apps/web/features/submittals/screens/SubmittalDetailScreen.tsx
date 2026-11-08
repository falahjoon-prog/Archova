'use client';

import Link from 'next/link';
import { RecordRecent } from '@/features/recents';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  Dialog,
  ItemHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Textarea,
} from '@archova/ui';
import { BookmarkButton } from '@/features/bookmarks';
import { webRoutes } from '@archova/routes';
import { atLeast } from '@archova/domain/permissions';
import { usePublishAssistantScope } from '@/features/assistant';
import { OnProgramme } from '@/features/schedule';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { SubmitBy, SubmittalStatusPill, ballLabel } from '../components/SubmittalChips';
import { useSubmittal, useSubmittalMutations } from '../hooks/useSubmittals';
import {
  ANSWER_LABELS,
  STEP_LABELS,
  TYPE_LABELS,
  type ReviewAnswer,
  type SubmittalDetail,
  type SubmittalRevision,
  type SubmittalStep,
} from '../lib/types';

/** One submittal (F1.5): the review path and who has it now, the revision history, and the actions for your turn. */
export function SubmittalDetailScreen({ submittalId }: { submittalId: string }) {
  const project = useCurrentProject();
  const q = useSubmittal(project.projectId, submittalId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: {
      type: 'submittal',
      id: submittalId,
      ...(q.data ? { label: q.data.submittal.numberLabel } : {}),
    },
  });
  if (q.isPending) return <SkeletonRows label="Loading submittal…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't open this submittal" />;
  return <Detail d={q.data} />;
}

function Detail({ d }: { d: SubmittalDetail }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const m = useSubmittalMutations(project.projectId);
  const [sending, setSending] = useState(false);
  const s = d.submittal;
  const current = d.revisions.find((r) => r.revision === s.currentRevision);
  const myStep = current?.steps.find(
    (x) => x.id === s.ballInCourt.stepId && x.approverId === actor.id,
  );
  const builderStep =
    current?.steps.find((x) => x.id === s.ballInCourt.stepId && x.kind === 'builder') ?? null;
  const canClose =
    (s.status === 'approved' || s.status === 'approved_as_noted') &&
    (perms.data?.orgRole === 'admin' ||
      perms.data?.orgRole === 'owner' ||
      atLeast(perms.data?.toolLevels.submittals, 'admin'));
  const canSend = s.status === 'draft' || s.status === 'revise_resubmit' || s.status === 'rejected';
  const turn = myStep ?? (builderStep && perms.data?.orgRole ? builderStep : null);

  return (
    <div className="stack-lg">
      <RecordRecent
        entityType="submittal"
        entityId={s.id}
        projectId={project.projectId}
        title={`${s.numberLabel} ${s.title}`}
      />
      <p className="u-m-0">
        <Link className="link" href={webRoutes.submittals(org.orgSlug, project.projectId)}>
          Submittals
        </Link>
      </p>
      <ItemHeader
        number={<span className="u-mono">{s.numberLabel}</span>}
        title={s.title}
        status={<SubmittalStatusPill status={s.status} />}
        ballInCourt={ballLabel(s, dir, actor.id)}
        due={<SubmitBy item={s} />}
        meta={
          s.status === 'draft' ? null : (
            <StatusPill tone="neutral">Revision {s.currentRevision}</StatusPill>
          )
        }
        actions={
          <>
            <BookmarkButton
              entityType="submittal"
              entityId={s.id}
              projectId={project.projectId}
              title={`${s.numberLabel} ${s.title}`}
              subtitle={s.status}
            />
            {canSend ? (
              <Button onClick={() => setSending(true)}>
                {s.status === 'draft' ? 'Submit for review' : 'Resubmit'}
              </Button>
            ) : null}
            {canClose ? (
              <Button
                onClick={() => m.close.mutate({ id: s.id, version: s.version })}
                disabled={m.close.isPending}
              >
                Close
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={m.close.error} title="We couldn't close this submittal" />
      {s.status === 'revise_resubmit' || s.status === 'rejected' ? (
        <Alert tone="warning" title={s.status === 'rejected' ? 'Rejected' : 'Revise and resubmit'}>
          The ball is back with{' '}
          {s.responsibleCompanyId ? dir.companyName(s.responsibleCompanyId) : 'the subcontractor'}.
          The comments from the review are below.
        </Alert>
      ) : null}
      {s.status === 'approved' || s.status === 'approved_as_noted' ? (
        <Alert tone="success" title={s.status === 'approved' ? 'Approved' : 'Approved as noted'}>
          {s.status === 'approved_as_noted'
            ? 'Read the reviewers’ notes before this is ordered or installed.'
            : 'This can be ordered and installed.'}
        </Alert>
      ) : null}

      {turn ? <RespondForm key={turn.id} detail={d} step={turn} /> : null}

      <div className="detail-grid">
        <Card title="Review">
          <div className="stack">
            {d.revisions.length === 0 ? (
              <p className="u-muted u-m-0">Not sent for review yet.</p>
            ) : (
              [...d.revisions]
                .reverse()
                .map((r) => (
                  <Revision
                    key={r.revision}
                    revision={r}
                    isCurrent={r.revision === s.currentRevision}
                  />
                ))
            )}
          </div>
        </Card>
        <div className="stack-lg">
          <Card title="Details">
            <DescriptionList
              items={[
                { label: 'Type', value: TYPE_LABELS[s.type] },
                { label: 'Spec section', value: s.specSection ?? '—' },
                {
                  label: 'Responsible',
                  value: s.responsibleCompanyId ? dir.companyName(s.responsibleCompanyId) : '—',
                },
                {
                  label: 'Builder reviewer',
                  value: s.managerId ? dir.personName(s.managerId) : '—',
                },
                {
                  label: 'Required on site',
                  value: s.requiredOnSite ? formatLocalDate(s.requiredOnSite) : '—',
                },
                { label: 'Lead time', value: `${s.leadTimeDays} business days` },
                { label: 'Review time', value: `${s.reviewDays} business days` },
              ]}
            />
          </Card>
          <OnProgramme kind="submittal" itemId={s.id} headingClass="u-h3" />
        </div>
      </div>

      <SendDialog
        open={sending}
        onClose={() => setSending(false)}
        detail={d}
        pending={m.submit.isPending}
        error={m.submit.error}
        onSend={(v) =>
          m.submit.mutate(
            { id: s.id, version: s.version, ...v },
            { onSuccess: () => setSending(false) },
          )
        }
      />
    </div>
  );
}

function Revision({ revision, isCurrent }: { revision: SubmittalRevision; isCurrent: boolean }) {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  return (
    <article className="stack" aria-label={`Revision ${revision.revision}`}>
      <h3 className="u-h4 u-m-0">
        Revision {revision.revision}
        {isCurrent ? ' (current)' : ''}{' '}
        <span className="u-caption">
          sent {formatInstant(revision.submittedAt, project.timezone)}
          {revision.submittedBy ? ` by ${dir.personName(revision.submittedBy)}` : ''} ·{' '}
          {revision.fileIds.length} {revision.fileIds.length === 1 ? 'file' : 'files'}
        </span>
      </h3>
      {revision.note ? <p className="u-m-0">{revision.note}</p> : null}
      <ol className="stack" aria-label={`Review steps for revision ${revision.revision}`}>
        {revision.steps.map((st) => (
          <Step key={st.id} step={st} />
        ))}
      </ol>
    </article>
  );
}

const STEP_TONE: Record<
  SubmittalStep['response'],
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  pending: 'info',
  forwarded: 'neutral',
  approved: 'success',
  approved_as_noted: 'success',
  revise_resubmit: 'warning',
  rejected: 'danger',
  skipped: 'neutral',
};

function Step({ step }: { step: SubmittalStep }) {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  return (
    <li>
      <p className="u-m-0">
        <strong>
          {step.step}. {step.kind === 'builder' ? 'Builder' : 'Consultant'}
        </strong>{' '}
        · {dir.personName(step.approverId)}{' '}
        <StatusPill tone={STEP_TONE[step.response]}>{STEP_LABELS[step.response]}</StatusPill>{' '}
        <span className="u-caption">
          {step.respondedAt
            ? formatInstant(step.respondedAt, project.timezone)
            : step.dueDate
              ? `due ${formatLocalDate(step.dueDate)}`
              : ''}
        </span>
      </p>
      {step.comments ? <p className="u-m-0">{step.comments}</p> : null}
    </li>
  );
}

/** The reviewer's answer (SUB-AC3, AC4): the builder forwards or returns a status; a consultant returns a status. */
function RespondForm({ detail, step }: { detail: SubmittalDetail; step: SubmittalStep }) {
  const project = useCurrentProject();
  const m = useSubmittalMutations(project.projectId);
  const later = detail.revisions
    .find((r) => r.revision === detail.submittal.currentRevision)
    ?.steps.some((x) => x.step > step.step);
  const options: ReviewAnswer[] =
    step.kind === 'builder' && later
      ? ['forwarded', 'revise_resubmit', 'rejected']
      : step.kind === 'builder'
        ? ['approved', 'approved_as_noted', 'revise_resubmit', 'rejected']
        : ['approved', 'approved_as_noted', 'revise_resubmit', 'rejected'];
  const [response, setResponse] = useState<ReviewAnswer>(options[0]!);
  const [comments, setComments] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if ((response === 'revise_resubmit' || response === 'rejected') && !comments.trim()) {
      setError('Say what needs to change so it can be fixed.');
      return;
    }
    setError(null);
    m.respond.mutate({ id: detail.submittal.id, stepId: step.id, response, comments, files });
  };

  return (
    <form className="stack" onSubmit={send} noValidate aria-labelledby="sub-respond">
      <h2 id="sub-respond" className="u-h3">
        Your review
      </h2>
      <Select
        label="Your answer"
        value={response}
        options={options.map((o) => ({ value: o, label: ANSWER_LABELS[o] }))}
        onChange={(e) => setResponse(e.target.value as ReviewAnswer)}
      />
      <Textarea
        label="Comments"
        rows={3}
        value={comments}
        error={error ?? undefined}
        onChange={(e) => setComments(e.target.value)}
      />
      <div className="stack">
        <label className="ac-field__label" htmlFor="sub-markup">
          Marked-up PDF (optional)
        </label>
        <input
          id="sub-markup"
          className="file-input"
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </div>
      <ErrorAlert error={m.respond.error} title="We couldn't save your review" />
      <div className="row-actions">
        <Button type="submit" disabled={m.respond.isPending}>
          {m.respond.isPending
            ? 'Sending…'
            : response === 'forwarded'
              ? 'Forward'
              : 'Return status'}
        </Button>
      </div>
    </form>
  );
}

function SendDialog({
  open,
  onClose,
  detail,
  pending,
  error,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  detail: SubmittalDetail;
  pending: boolean;
  error: unknown;
  onSend: (v: { files: File[]; note: string; reviewerIds?: string[] }) => void;
}) {
  const dir = useProjectDirectory();
  const first = detail.submittal.currentRevision === 0 && detail.revisions.length === 0;
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const people = dir.people.filter((p) => p.id !== detail.submittal.managerId);

  const send = () => {
    if (!files.length) {
      setProblem('Attach the package to review.');
      return;
    }
    setProblem(null);
    onSend({ files, note, ...(first || reviewers.length ? { reviewerIds: reviewers } : {}) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={first ? 'Submit for review' : 'Resubmit'}
      description={
        first
          ? 'The builder reviews first, then the consultants you choose, in order.'
          : 'This opens the next revision. It goes back down the same review path unless you pick a new one.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={send}>
            {pending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="stack">
          <label className="ac-field__label" htmlFor="sub-package">
            Package (PDF, drawings or photos)
          </label>
          <input
            id="sub-package"
            className="file-input"
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {problem ? <p className="ac-field__error">{problem}</p> : null}
        </div>
        <Textarea
          label="Note to reviewers (optional)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <fieldset className="fieldset">
          <legend>Consultants, in review order</legend>
          <div className="stack">
            {people.map((p) => {
              const at = reviewers.indexOf(p.id);
              return (
                <label key={p.id} className="choice-card">
                  <input
                    type="checkbox"
                    checked={at >= 0}
                    onChange={(e) =>
                      setReviewers((r) =>
                        e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <span>
                    {p.name}
                    {p.companyId ? (
                      <span className="u-caption"> · {dir.companyName(p.companyId)}</span>
                    ) : null}
                    {at >= 0 ? <span className="u-caption"> · step {at + 2}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <ErrorAlert error={error} title="We couldn't send this" />
      </div>
    </Dialog>
  );
}
