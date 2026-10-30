'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Select, StatusPill, TextField, Textarea } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type { MeetingDetail, MeetingItem } from '../data/api';
import { useMeetingMutations } from '../hooks/useMeetings';
import { KIND_LABELS, carriedLabel } from '../lib/labels';

type Section = MeetingDetail['sections'][number];

const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));

/** An RFI or defect link goes to its page; a variation has none yet and shows as text. */
function linkHref(orgSlug: string, projectId: string, link: NonNullable<MeetingItem['link']>) {
  if (link.type === 'rfi') return webRoutes.rfi(orgSlug, projectId, link.id);
  if (link.type === 'defect') return webRoutes.defect(orgSlug, projectId, link.id);
  return null;
}

function ItemRow({
  item,
  meetingId,
  canEdit,
}: {
  item: MeetingItem;
  meetingId: string;
  canEdit: boolean;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const { updateItem, deleteItem } = useMeetingMutations(meetingId);
  const error = updateItem.error ?? deleteItem.error;
  const href = item.link ? linkHref(org.orgSlug, project.projectId, item.link) : null;
  const carried = item.history.length > 0;
  return (
    <li className="minutes-item">
      <div className="minutes-item__head">
        <span className="u-mono minutes-item__no">{item.itemNo}</span>
        <StatusPill tone={item.kind === 'action' ? 'info' : 'neutral'}>
          {KIND_LABELS[item.kind]}
        </StatusPill>
        {item.kind === 'action' ? (
          <StatusPill tone={item.status === 'open' ? 'warning' : 'success'}>
            {item.status === 'open' ? 'Open' : 'Closed'}
          </StatusPill>
        ) : null}
        {item.stale ? (
          <StatusPill tone="danger">{carriedLabel(item.carriedCount)}</StatusPill>
        ) : null}
      </div>
      <p className="minutes-item__body">{item.body}</p>
      <p className="u-caption u-m-0">
        {item.ownerName ? <>Owner: {item.ownerName}. </> : null}
        {item.dueDate ? <>Due {formatLocalDate(item.dueDate)}. </> : null}
        {item.carriedCount > 0 && !item.stale ? <>{carriedLabel(item.carriedCount)}. </> : null}
        {item.link ? (
          href ? (
            <Link className="link" href={href}>
              Linked {item.link.type}
            </Link>
          ) : (
            <>Linked {item.link.type}</>
          )
        ) : null}
      </p>
      {carried ? (
        <details className="minutes-item__history">
          <summary>History ({item.history.length})</summary>
          <ul>
            {item.history.map((h) => (
              <li key={h.meetingId}>
                Meeting {h.meetingNumber}, {h.itemNo}: {h.body} ({h.status})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ErrorAlert error={error} title="We couldn't change this item" />
      {canEdit ? (
        <div className="minutes-item__actions">
          {item.kind === 'action' ? (
            <Button
              variant="secondary"
              size="sm"
              loading={updateItem.isPending}
              onClick={() =>
                updateItem.mutate({
                  item,
                  body: { status: item.status === 'open' ? 'closed' : 'open' },
                })
              }
            >
              {item.status === 'open' ? 'Close action' : 'Reopen'}
            </Button>
          ) : null}
          {!carried && item.carriedCount === 0 ? (
            <Button
              variant="tertiary"
              size="sm"
              loading={deleteItem.isPending}
              onClick={() => deleteItem.mutate(item.id)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AddItemForm({ section, meetingId }: { section: Section; meetingId: string }) {
  const directory = useProjectDirectory();
  const { createItem } = useMeetingMutations(meetingId);
  const [kind, setKind] = useState<MeetingItem['kind']>('action');
  const [body, setBody] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setProblem('Write what was said or agreed.');
    setProblem(null);
    createItem.mutate(
      {
        sectionId: section.id,
        kind,
        body: body.trim(),
        ...(kind === 'action' && companyId ? { ownerCompanyId: companyId } : {}),
        ...(kind === 'action' && dueDate ? { dueDate } : {}),
      },
      {
        onSuccess: () => {
          setBody('');
          setDueDate('');
        },
      },
    );
  }

  return (
    <form
      className="stack minutes-add"
      onSubmit={submit}
      noValidate
      aria-label={`Add to ${section.title}`}
    >
      <ErrorAlert error={createItem.error} title="We couldn't add the item" />
      <div className="form-row">
        <Select
          label="Type"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(e) => setKind(e.target.value as MeetingItem['kind'])}
        />
        {kind === 'action' ? (
          <>
            <Select
              label="Owner"
              placeholder="No owner yet"
              options={directory.companies
                .filter((c) => directory.onProject(c.id))
                .map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            />
            <TextField
              label="Due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </>
        ) : null}
      </div>
      <Textarea
        label={`New ${KIND_LABELS[kind].toLowerCase()} in ${section.title}`}
        rows={2}
        value={body}
        maxLength={5000}
        onChange={(e) => setBody(e.target.value)}
        error={problem ?? undefined}
      />
      <div>
        <Button type="submit" variant="secondary" loading={createItem.isPending}>
          Add item
        </Button>
      </div>
    </form>
  );
}

/** One agenda section with its numbered items (MTG-AC1). */
export function SectionCard({
  section,
  meetingId,
  canEdit,
}: {
  section: Section;
  meetingId: string;
  canEdit: boolean;
}) {
  return (
    <section className="minutes-section" aria-labelledby={`sec-${section.id}`}>
      <h2 id={`sec-${section.id}`} className="panel-heading">
        {section.position}. {section.title}{' '}
        {section.internalOnly ? <StatusPill tone="neutral">Builder only</StatusPill> : null}
      </h2>
      {section.items.length === 0 ? (
        <p className="u-muted">Nothing recorded.</p>
      ) : (
        <ul className="minutes-items">
          {section.items.map((i) => (
            <ItemRow key={i.id} item={i} meetingId={meetingId} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit ? <AddItemForm section={section} meetingId={meetingId} /> : null}
    </section>
  );
}
