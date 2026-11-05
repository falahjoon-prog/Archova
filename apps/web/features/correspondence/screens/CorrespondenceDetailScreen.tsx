'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  DescriptionList,
  Dialog,
  ItemHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { atLeast } from '@archova/domain/permissions';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { CorrespondenceStatusPill, TimeBar } from '../components/CorrespondenceChips';
import { useCorrespondence, useCorrespondenceMutations } from '../hooks/useCorrespondence';
import type { CorrespondenceDetail } from '../lib/types';

/** One item: the draft editor while it is a draft, then the frozen record, its replies and the actions left. */
export function CorrespondenceDetailScreen({ correspondenceId }: { correspondenceId: string }) {
  const project = useCurrentProject();
  const q = useCorrespondence(project.projectId, correspondenceId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: {
      type: 'correspondence',
      id: correspondenceId,
      ...(q.data ? { label: q.data.item.numberLabel } : {}),
    },
  });
  if (q.isPending) return <SkeletonRows label="Loading correspondence…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't open this item" />;
  return <Detail d={q.data} />;
}

function Detail({ d }: { d: CorrespondenceDetail }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const m = useCorrespondenceMutations(project.projectId);
  const [voiding, setVoiding] = useState(false);
  const i = d.item;
  const isAdmin =
    perms.data?.orgRole === 'admin' ||
    perms.data?.orgRole === 'owner' ||
    atLeast(perms.data?.toolLevels.correspondence, 'admin');
  const canClose = isAdmin && (i.status === 'sent' || i.status === 'responded');
  const canVoid =
    isAdmin &&
    (i.status === 'draft' ||
      ((i.status === 'sent' || i.status === 'responded') && !i.isEvidential));

  return (
    <div className="stack-lg">
      <p className="u-m-0">
        <Link className="link" href={webRoutes.correspondence(org.orgSlug, project.projectId)}>
          Correspondence
        </Link>
      </p>
      <ItemHeader
        number={<span className="u-mono">{i.numberLabel}</span>}
        title={i.subject || i.typeName}
        status={<CorrespondenceStatusPill status={i.status} />}
        due={<TimeBar item={i} />}
        meta={i.isEvidential ? <StatusPill tone="neutral">Evidence</StatusPill> : null}
        actions={
          <>
            {i.status === 'draft' ? (
              <Button
                onClick={() => m.send.mutate({ id: i.id, version: i.version })}
                disabled={m.send.isPending}
              >
                {m.send.isPending ? 'Sending…' : 'Send'}
              </Button>
            ) : null}
            {canClose ? (
              <Button
                variant="secondary"
                onClick={() => m.close.mutate({ id: i.id, version: i.version })}
                disabled={m.close.isPending}
              >
                Close
              </Button>
            ) : null}
            {canVoid ? (
              <Button variant="secondary" onClick={() => setVoiding(true)}>
                Void
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={m.send.error ?? m.close.error} title="We couldn't update this item" />
      {i.status === 'sent' && i.isEvidential ? (
        <Alert tone="info" title="Sent as a record">
          This {i.typeName.toLowerCase()} can no longer be edited or voided. Its content fingerprint
          is <span className="u-mono">{i.contentHash?.slice(0, 12)}…</span>
          {i.sentInTime === false ? '. It was sent after the notice period ended.' : '.'}
        </Alert>
      ) : null}
      {i.status === 'void' ? (
        <Alert tone="warning" title="Void">
          {i.voidReason}
        </Alert>
      ) : null}

      {i.status === 'draft' ? <DraftEditor key={i.version} d={d} /> : <Record d={d} />}

      <section className="stack" aria-labelledby="cor-details">
        <h2 id="cor-details" className="u-h3">
          Details
        </h2>
        <DescriptionList
          items={[
            { label: 'Type', value: i.typeName },
            { label: 'From', value: i.fromCompanyId ? dir.companyName(i.fromCompanyId) : '—' },
            {
              label: 'To',
              value: i.toCompanyIds.length
                ? i.toCompanyIds.map((c) => dir.companyName(c)).join(', ')
                : '—',
            },
            {
              label: 'Sent',
              value: i.sentAt ? formatInstant(i.sentAt, project.timezone) : '—',
            },
            {
              label: 'Event date',
              value: i.eventDate ? formatLocalDate(i.eventDate) : '—',
            },
            {
              label: 'Response due',
              value: i.responseRequired && i.dueDate ? formatLocalDate(i.dueDate) : '—',
            },
          ]}
        />
      </section>

      <section className="stack" aria-labelledby="cor-replies">
        <h2 id="cor-replies" className="u-h3">
          Responses
        </h2>
        {d.responses.length === 0 ? (
          <p className="u-muted u-m-0">No responses yet.</p>
        ) : (
          d.responses.map((r) => (
            <article key={r.id} className="stack" aria-label="Response">
              <p className="u-caption u-m-0">
                {dir.personName(r.authorId)}
                {r.authorCompanyId ? ` · ${dir.companyName(r.authorCompanyId)}` : ''} ·{' '}
                {formatInstant(r.sentAt, project.timezone)}
              </p>
              <p className="u-m-0 u-prewrap">{r.body}</p>
            </article>
          ))
        )}
        {i.status === 'sent' || i.status === 'responded' ? <ReplyForm id={i.id} /> : null}
      </section>

      <VoidDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        pending={m.voidItem.isPending}
        error={m.voidItem.error}
        onVoid={(reason) =>
          m.voidItem.mutate(
            { id: i.id, version: i.version, reason },
            { onSuccess: () => setVoiding(false) },
          )
        }
      />
    </div>
  );
}

function Record({ d }: { d: CorrespondenceDetail }) {
  return (
    <section className="stack" aria-labelledby="cor-body">
      <h2 id="cor-body" className="u-h3">
        {d.item.subject}
      </h2>
      <p className="u-m-0 u-prewrap">{d.item.body}</p>
    </section>
  );
}

function DraftEditor({ d }: { d: CorrespondenceDetail }) {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const m = useCorrespondenceMutations(project.projectId);
  const i = d.item;
  const [subject, setSubject] = useState(i.subject);
  const [body, setBody] = useState(i.body);
  const [to, setTo] = useState<string[]>(i.toCompanyIds);
  const [eventDate, setEventDate] = useState(i.eventDate ?? '');

  const save = (e: FormEvent) => {
    e.preventDefault();
    m.update.mutate({ id: i.id, version: i.version, subject, body, toCompanyIds: to, eventDate });
  };

  return (
    <form className="stack" onSubmit={save} noValidate aria-labelledby="cor-edit">
      <h2 id="cor-edit" className="u-h3">
        Draft
      </h2>
      <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextField
        label="Date of the event"
        type="date"
        value={eventDate}
        hint="Starts the notice period for this type, if it has one."
        onChange={(e) => setEventDate(e.target.value)}
      />
      <fieldset className="fieldset">
        <legend>To</legend>
        <div className="stack">
          {dir.companies.map((c) => (
            <label key={c.id} className="choice-card">
              <input
                type="checkbox"
                checked={to.includes(c.id)}
                onChange={(e) =>
                  setTo((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))
                }
              />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Textarea label="Message" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
      <ErrorAlert error={m.update.error} title="We couldn't save this draft" />
      <div className="row-actions">
        <Button type="submit" variant="secondary" disabled={m.update.isPending}>
          {m.update.isPending ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ id }: { id: string }) {
  const project = useCurrentProject();
  const m = useCorrespondenceMutations(project.projectId);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write your response.');
      return;
    }
    setError(null);
    m.respond.mutate(
      { id, body, files },
      {
        onSuccess: () => {
          setBody('');
          setFiles([]);
        },
      },
    );
  };

  return (
    <form className="stack" onSubmit={send} noValidate aria-label="Respond">
      <Textarea
        label="Respond"
        rows={3}
        value={body}
        error={error ?? undefined}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="stack">
        <label className="ac-field__label" htmlFor="cor-files">
          Attachments (optional)
        </label>
        <input
          id="cor-files"
          className="file-input"
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </div>
      <ErrorAlert error={m.respond.error} title="We couldn't send your response" />
      <div className="row-actions">
        <Button type="submit" disabled={m.respond.isPending}>
          {m.respond.isPending ? 'Sending…' : 'Send response'}
        </Button>
      </div>
    </form>
  );
}

function VoidDialog({
  open,
  onClose,
  pending,
  error,
  onVoid,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  error: unknown;
  onVoid: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Void this item"
      description="It stays in the register as void, with your reason."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (!reason.trim()) {
                setProblem('Give a reason.');
                return;
              }
              setProblem(null);
              onVoid(reason);
            }}
          >
            {pending ? 'Voiding…' : 'Void'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          error={problem ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't void this" />
      </div>
    </Dialog>
  );
}
