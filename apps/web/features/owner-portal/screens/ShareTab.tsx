'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { OwnerPortalIcon } from '@archova/ui/icons';
import { usePhotoFeed } from '@/features/photos';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CreatedShareLink, ShareLink } from '../data/api';
import { useOwnerPortalMutations, useShareLinks, useSharedPhotos } from '../hooks/useOwnerPortal';

const STATE_LABEL: Record<ShareLink['state'], string> = {
  active: 'Working',
  expired: 'Expired',
  revoked: 'Turned off',
  used_up: 'Used up',
};
const STATE_TONE: Record<ShareLink['state'], StatusTone> = {
  active: 'success',
  expired: 'neutral',
  revoked: 'neutral',
  used_up: 'neutral',
};

/**
 * Team only: the no-login link the client opens on their phone, and the photos it shows. Nothing is shared until
 * someone picks it: photos here, updates by publishing them on the Progress tab, changes by approving them.
 */
export function ShareTab() {
  return (
    <div className="stack-lg">
      <Alert tone="info" title="What the client sees">
        Published progress updates, upcoming milestones, approved changes (no amounts) and the
        photos you pick below. Never costs, budgets, commitments or correspondence.
      </Alert>
      <LinksSection />
      <PhotosSection />
    </div>
  );
}

function LinksSection() {
  const list = useShareLinks();
  const m = useOwnerPortalMutations();
  const project = useCurrentProject();
  const [creating, setCreating] = useState(false);
  const data = list.data ?? [];
  const columns = [
    {
      id: 'label',
      header: 'Link',
      rowHeader: true,
      cell: (l) => (
        <span>
          {l.label ?? 'Client link'}
          {l.recipientEmail ? (
            <>
              <br />
              <span className="u-caption">{l.recipientEmail}</span>
            </>
          ) : null}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'Status',
      cell: (l) => <StatusPill tone={STATE_TONE[l.state]}>{STATE_LABEL[l.state]}</StatusPill>,
    },
    {
      id: 'expires',
      header: 'Expires',
      cell: (l) => formatInstant(l.expiresAt, project.timezone),
    },
    {
      id: 'opened',
      header: 'Last opened',
      cell: (l) => (l.lastUsedAt ? formatInstant(l.lastUsedAt, project.timezone) : 'Not yet'),
    },
    {
      id: 'actions',
      header: <span className="u-visually-hidden">Actions</span>,
      cell: (l) =>
        l.state === 'active' ? (
          <Button
            variant="secondary"
            disabled={m.revokeShareLink.isPending}
            aria-label={`Turn off ${l.label ?? 'client link'}`}
            onClick={() => m.revokeShareLink.mutate(l.id)}
          >
            Turn off
          </Button>
        ) : null,
    },
  ] satisfies DataTableColumn<ShareLink>[];
  return (
    <Card
      title="Client links"
      actions={<Button onClick={() => setCreating(true)}>New client link</Button>}
    >
      <div className="stack">
        <ErrorAlert error={list.error} title="We couldn't load the client links" />
        <ErrorAlert error={m.revokeShareLink.error} title="We couldn't turn this link off" />
        {list.isPending ? (
          <SkeletonRows label="Loading client links…" />
        ) : data.length === 0 ? (
          <EmptyState
            icon={OwnerPortalIcon}
            title="No client links yet"
            description="Make a link to send your client. They open it on any device, no account needed."
          />
        ) : (
          <DataTable caption="Client links" columns={columns} rows={data} getRowId={(l) => l.id} />
        )}
      </div>
      {creating ? <LinkDialog onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}

function LinkDialog({ onClose }: { onClose: () => void }) {
  const m = useOwnerPortalMutations();
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('30');
  const [made, setMade] = useState<CreatedShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 90;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    m.createShareLink.mutate(
      {
        label: label.trim() || null,
        recipientEmail: email.trim() || null,
        expiresInDays: n,
      },
      { onSuccess: setMade },
    );
  };
  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={made ? 'Client link ready' : 'New client link'}
      footer={
        made ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="share-link-form"
              disabled={!valid || m.createShareLink.isPending}
            >
              {m.createShareLink.isPending ? 'Making…' : 'Make link'}
            </Button>
          </>
        )
      }
    >
      {made ? (
        <div className="stack">
          <p className="u-m-0">
            {made.emailed ? `We emailed this link to ${made.link.recipientEmail}. ` : ''}
            Copy it now: for safety it can&apos;t be shown again. You can turn it off any time.
          </p>
          <TextField
            label="Client link"
            value={made.url}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <div className="row-actions">
            <Button variant="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      ) : (
        <form id="share-link-form" className="stack" onSubmit={submit}>
          <TextField
            label="Name for this link"
            value={label}
            hint="For example, Harbour board. Only you see this."
            onChange={(e) => setLabel(e.target.value)}
          />
          <TextField
            label="Email it to (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Works for (days)"
            inputMode="numeric"
            value={days}
            hint="1 to 90"
            error={valid ? undefined : 'Enter a whole number from 1 to 90'}
            onChange={(e) => setDays(e.target.value)}
          />
          <ErrorAlert error={m.createShareLink.error} title="We couldn't make this link" />
        </form>
      )}
    </Dialog>
  );
}

function PhotosSection() {
  const shared = useSharedPhotos();
  const m = useOwnerPortalMutations();
  const [picking, setPicking] = useState(false);
  const data = shared.data ?? [];
  return (
    <Card
      title="Photos on the client link"
      actions={<Button onClick={() => setPicking(true)}>Pick photos</Button>}
    >
      <div className="stack">
        <ErrorAlert error={shared.error} title="We couldn't load the shared photos" />
        <ErrorAlert error={m.unsharePhoto.error} title="We couldn't remove this photo" />
        {shared.isPending ? (
          <SkeletonRows label="Loading shared photos…" />
        ) : data.length === 0 ? (
          <EmptyState
            icon={OwnerPortalIcon}
            title="No photos shared"
            description="Pick progress photos from the site photos. Only the ones you pick appear for the client."
          />
        ) : (
          <ul className="photo-tiles" aria-label="Photos on the client link">
            {data.map((p) => (
              <li key={p.fileId}>
                <div className="photo-tiles__tile">
                  {/* Signed storage links, not static assets, so next/image can't optimise them. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || p.filename} loading="lazy" />
                </div>
                <p className="photo-tiles__caption u-caption">{p.caption || p.filename}</p>
                <Button
                  variant="secondary"
                  disabled={m.unsharePhoto.isPending}
                  aria-label={`Remove ${p.caption || p.filename} from the client link`}
                  onClick={() => m.unsharePhoto.mutate(p.fileId)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picking ? (
        <PickDialog
          sharedIds={new Set(data.map((p) => p.fileId))}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </Card>
  );
}

function PickDialog({ sharedIds, onClose }: { sharedIds: Set<string>; onClose: () => void }) {
  const feed = usePhotoFeed({});
  const m = useOwnerPortalMutations();
  const photos = feed.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Pick photos for the client"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="stack">
        <ErrorAlert error={feed.error} title="We couldn't load the site photos" />
        <ErrorAlert error={m.sharePhoto.error} title="We couldn't share this photo" />
        {feed.isPending ? (
          <SkeletonRows label="Loading site photos…" />
        ) : photos.length === 0 ? (
          <p className="u-m-0">There are no site photos on this project yet.</p>
        ) : (
          <ul className="photo-tiles" aria-label="Site photos">
            {photos.map((p) => {
              const on = sharedIds.has(p.file.id);
              return (
                <li key={p.file.id}>
                  <button
                    type="button"
                    className="photo-tiles__tile"
                    aria-pressed={on}
                    aria-label={`${on ? 'Already shared' : 'Share'} ${p.file.filename}`}
                    disabled={on || m.sharePhoto.isPending}
                    onClick={() => m.sharePhoto.mutate({ fileId: p.file.id, caption: '' })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" loading="lazy" />
                    {on ? <span className="photo-tiles__flag">Shared</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {feed.hasNextPage ? (
          <Button
            variant="secondary"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
