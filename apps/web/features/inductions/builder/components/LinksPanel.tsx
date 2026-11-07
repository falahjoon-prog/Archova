'use client';

import { useState } from 'react';
import { Button, Dialog, EmptyState, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { InductionsIcon, Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useInductionLinkMutations, useInductionLinks } from '../hooks/useBuilder';
import {
  LINK_STATE,
  type CreateInductionLinkInput,
  type Induction,
  type InductionLinkCreated,
} from '../lib/types';

/** What the form turns into a request, or the first thing wrong with it. */
export function parseLinkForm(f: {
  label: string;
  expiresInDays: string;
  maxUses: string;
}): { ok: true; input: CreateInductionLinkInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const days = Number(f.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    errors.expiresInDays = 'Enter a whole number of days from 1 to 90.';
  const uses = f.maxUses.trim() ? Number(f.maxUses) : null;
  if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 10_000))
    errors.maxUses = 'Enter a whole number from 1 to 10,000, or leave it empty.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      ...(f.label.trim() ? { label: f.label.trim() } : {}),
      expiresInDays: days,
      ...(uses !== null ? { maxUses: uses } : {}),
    },
  };
}

/** Links workers open on their phone to do the induction with no account (IND-AC3, X45). */
export function LinksPanel({ induction }: { induction: Induction }) {
  const project = useCurrentProject();
  const directory = useProjectDirectory();
  const links = useInductionLinks(induction.id);
  const m = useInductionLinkMutations(induction.id);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', expiresInDays: '30', maxUses: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<InductionLinkCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const canCreate = induction.status === 'published';

  function submit() {
    const parsed = parseLinkForm(form);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    m.create.mutate(parsed.input, {
      onSuccess: (res) => {
        setCreating(false);
        setCreated(res);
        setCopied(false);
        setForm({ label: '', expiresInDays: '30', maxUses: '' });
      },
    });
  }

  const fullUrl = created
    ? created.url.startsWith('/')
      ? `${window.location.origin}${created.url}`
      : created.url
    : '';

  return (
    <div className="stack">
      <div className="row-actions">
        <p className="u-m-0 u-muted">
          Share a link with a crew or print it as a poster. Each worker confirms their own mobile
          before they start.
        </p>
        <Button disabled={!canCreate} onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> Create link
        </Button>
      </div>
      {!canCreate ? (
        <p className="u-caption u-m-0">Publish a version before sharing a link.</p>
      ) : null}
      <ErrorAlert error={m.revoke.error} title="We couldn't revoke that link" />
      {links.isPending ? (
        <SkeletonRows label="Loading links…" />
      ) : !links.data ? (
        <ErrorAlert error={links.error} title="We couldn't load the links" />
      ) : links.data.length === 0 ? (
        <EmptyState
          icon={InductionsIcon}
          title="No links yet"
          description="Create a link to send to a crew or print as a gate poster."
        />
      ) : (
        <ul className="plain-list">
          {links.data.map((l) => {
            const state = LINK_STATE[l.state];
            return (
              <li key={l.id} className="plain-list__item">
                <div className="row-actions">
                  <strong>{l.label ?? 'Unnamed link'}</strong>
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                  {l.state === 'active' ? (
                    <Button
                      variant="secondary"
                      disabled={m.revoke.isPending}
                      aria-label={`Revoke ${l.label ?? 'link'}`}
                      onClick={() => m.revoke.mutate(l.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
                <span className="u-caption">
                  Opened {l.useCount}
                  {l.maxUses ? ` of ${l.maxUses}` : ''} times · expires{' '}
                  {formatInstant(l.expiresAt, project.timezone)} · made by{' '}
                  {directory.personName(l.createdBy)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Create link"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button loading={m.create.isPending} onClick={submit}>
              Create link
            </Button>
          </>
        }
      >
        <div className="stack">
          <ErrorAlert error={m.create.error} title="We couldn't create the link" />
          <TextField
            label="Who it is for (optional)"
            hint="For example, Sparkies crew or Gate poster."
            value={form.label}
            maxLength={200}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="form-row">
            <TextField
              label="Works for (days)"
              type="number"
              min={1}
              max={90}
              value={form.expiresInDays}
              error={errors.expiresInDays}
              onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
            />
            <TextField
              label="Most opens (optional)"
              type="number"
              min={1}
              value={form.maxUses}
              error={errors.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
            />
          </div>
        </div>
      </Dialog>
      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Your link is ready"
        description="Copy it now. For safety it is shown once and can't be looked up later."
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        <div className="stack">
          <TextField label="Link" readOnly value={fullUrl} onFocus={(e) => e.target.select()} />
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(fullUrl).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
