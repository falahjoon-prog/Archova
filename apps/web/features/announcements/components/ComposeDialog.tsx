'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  NovaSuggestion,
  Select,
  Textarea,
  TextField,
} from '@archova/ui';
import { useCompanies, useProjectMembers } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useDraftAnnouncement, usePostAnnouncement } from '../hooks/useAnnouncements';
import { READ_BY_OPTIONS } from '../lib/time';

const TITLE_MAX = 200;
const BODY_MAX = 5000;

/** Toggles one id in a list, keeping the order people picked them in. */
const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export function ComposeDialog({
  projectId,
  open,
  onClose,
  onPosted,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onPosted: (id: string) => void;
}) {
  const org = useCurrentOrg();
  const post = usePostAnnouncement(projectId);
  const draft = useDraftAnnouncement(projectId);
  const members = useProjectMembers(org.orgId, projectId);
  const companies = useCompanies(org.orgId);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [everyone, setEveryone] = useState(true);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [keyIds, setKeyIds] = useState<string[]>([]);
  const [readBy, setReadBy] = useState('');
  const [notes, setNotes] = useState('');
  const [fromNova, setFromNova] = useState<{ notes: string[] } | null>(null);

  const active = useMemo(
    () => (members.data?.data ?? []).filter((m) => m.status === 'active'),
    [members.data],
  );
  const companyName = useMemo(
    () => new Map((companies.data?.data ?? []).map((c) => [c.id, c.name])),
    [companies.data],
  );
  const projectCompanies = useMemo(
    () =>
      [...new Set(active.map((m) => m.companyId))]
        .map((id) => ({ id, name: companyName.get(id) ?? 'Company' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [active, companyName],
  );
  // Who the announcement would reach, so key people can only be picked from them. The sender is left out by the API.
  const audience = useMemo(
    () =>
      active.filter(
        (m) => everyone || companyIds.includes(m.companyId) || userIds.includes(m.userId),
      ),
    [active, everyone, companyIds, userIds],
  );
  const keysInAudience = keyIds.filter((k) => audience.some((m) => m.userId === k));
  const hasAudience = everyone || companyIds.length > 0 || userIds.length > 0;
  const ready = title.trim().length > 0 && body.trim().length > 0 && hasAudience;

  function reset() {
    setTitle('');
    setBody('');
    setImportant(false);
    setEveryone(true);
    setCompanyIds([]);
    setUserIds([]);
    setKeyIds([]);
    setReadBy('');
    setNotes('');
    setFromNova(null);
    draft.reset();
    post.reset();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    post.mutate(
      {
        title: title.trim(),
        body: body.trim(),
        priority: important ? 'important' : 'normal',
        audience: everyone ? { kind: 'all' } : { kind: 'group', companyIds, userIds },
        ...(keysInAudience.length ? { keyUserIds: keysInAudience } : {}),
        readByHours: readBy ? Number(readBy) : null,
      },
      {
        onSuccess: (created) => {
          reset();
          onPosted(created.id);
        },
      },
    );
  }

  function askNova() {
    draft.mutate(
      { notes: notes.trim(), ...(everyone ? {} : { audience: 'selected people' }) },
      {
        onSuccess: (d) => {
          setTitle(d.title);
          setBody(d.body);
          setImportant(d.priority === 'important');
          setFromNova({ notes: d.notes });
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="New announcement">
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={post.error} title="We couldn't post the announcement" />
        <div className="stack announcements__nova">
          <Textarea
            label="What changed? (optional)"
            hint="Paste or type rough notes and Nova will draft the announcement for you to edit."
            rows={3}
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="row-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={notes.trim().length === 0}
              loading={draft.isPending}
              onClick={askNova}
            >
              Draft with Nova
            </Button>
          </div>
          <ErrorAlert error={draft.error} title="Nova couldn't draft this" />
          {fromNova ? (
            <NovaSuggestion title="Check the draft below before you post">
              <p className="u-m-0">
                Nova only used what your notes say. Edit the title and message as you like.
              </p>
              {fromNova.notes.map((n) => (
                <p key={n} className="u-m-0 u-muted">
                  {n}
                </p>
              ))}
            </NovaSuggestion>
          ) : null}
        </div>
        <TextField
          label="Title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Textarea
          label="Message"
          rows={6}
          value={body}
          maxLength={BODY_MAX}
          aiFilled={fromNova !== null}
          onChange={(e) => {
            setBody(e.target.value);
            setFromNova(null);
          }}
          required
        />
        <Checkbox
          label="Mark as important"
          checked={important}
          onChange={(e) => setImportant(e.target.checked)}
        />

        <fieldset className="announcements__group">
          <legend>Who is it for?</legend>
          <Checkbox
            label="Everyone on the project"
            hint="Includes subcontractors and other outside members."
            checked={everyone}
            onChange={(e) => setEveryone(e.target.checked)}
          />
          {!everyone ? (
            <>
              <p className="u-caption u-m-0">Companies</p>
              {projectCompanies.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={companyIds.includes(c.id)}
                  onChange={() => setCompanyIds((l) => toggle(l, c.id))}
                />
              ))}
              <p className="u-caption u-m-0">People</p>
              {active.map((m) => (
                <Checkbox
                  key={m.userId}
                  label={m.name || m.email}
                  checked={userIds.includes(m.userId)}
                  onChange={() => setUserIds((l) => toggle(l, m.userId))}
                />
              ))}
              {!hasAudience ? (
                <Alert tone="info">Choose at least one company or person.</Alert>
              ) : null}
            </>
          ) : null}
        </fieldset>

        <fieldset className="announcements__group">
          <legend>Make sure the right people read it</legend>
          <Select
            label="Key people should read it within"
            hint="Nova flags anyone still unread after this, and you choose whether to remind them."
            value={readBy}
            options={READ_BY_OPTIONS}
            onChange={(e) => setReadBy(e.target.value)}
          />
          {readBy ? (
            <>
              <p className="u-caption u-m-0">Key people (leave empty to track everyone)</p>
              {audience.map((m) => (
                <Checkbox
                  key={m.userId}
                  label={m.name || m.email}
                  checked={keyIds.includes(m.userId)}
                  onChange={() => setKeyIds((l) => toggle(l, m.userId))}
                />
              ))}
            </>
          ) : null}
        </fieldset>

        <div className="row-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready} loading={post.isPending}>
            Post announcement
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
