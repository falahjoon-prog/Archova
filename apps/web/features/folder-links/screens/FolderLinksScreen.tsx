'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { PROVIDER_NAME, type FolderLink, type Provider } from '../data/api';
import {
  useCreateFolderLink,
  useFolderConnections,
  useFolderLinks,
  useRemoveFolderLink,
} from '../hooks/useFolders';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function LinkRow({ link }: { link: FolderLink }) {
  const remove = useRemoveFolderLink();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="folders__item">
      <div className="folders__head">
        <strong>{link.folderName}</strong>
        <StatusPill tone={link.status === 'active' ? 'success' : 'danger'}>
          {link.status === 'active' ? 'Publishing' : 'Needs attention'}
        </StatusPill>
      </div>
      <span className="u-caption">
        {PROVIDER_NAME[link.provider]} ·{' '}
        {link.lastPublishedAt
          ? `Last published ${formatInstant(link.lastPublishedAt, tz())}`
          : 'Nothing published yet'}
      </span>
      {link.lastError ? <Alert tone="warning">{link.lastError}</Alert> : null}
      <div className="folders__danger">
        {link.webUrl ? (
          <a href={link.webUrl} target="_blank" rel="noreferrer">
            Open folder
          </a>
        ) : null}
        {confirming ? (
          <>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(link.id)}
            >
              Yes, stop publishing
            </Button>
            <Button variant="tertiary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="tertiary" onClick={() => setConfirming(true)}>
            Stop publishing
          </Button>
        )}
      </div>
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
    </li>
  );
}

function LinkForm({ providers, taken }: { providers: Provider[]; taken: Provider[] }) {
  const create = useCreateFolderLink();
  const options = providers
    .filter((p) => !taken.includes(p))
    .map((p) => ({ value: p, label: PROVIDER_NAME[p] }));
  const [provider, setProvider] = useState<Provider | ''>('');
  const [url, setUrl] = useState('');
  const chosen = (provider || options[0]?.value || '') as Provider | '';
  if (options.length === 0) return null;
  const needsUrl = chosen === 'm365';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    create.mutate(
      { provider: chosen, ...(needsUrl ? { url: url.trim() } : {}) },
      { onSuccess: () => setUrl('') },
    );
  };
  return (
    <Card title="Publish to a folder">
      <form className="stack" onSubmit={submit}>
        <p className="u-m-0">
          Each drawing revision issued from now on is uploaded, and the one it replaces moves to a
          Superseded folder. Drawings that are current today are published first. Changes made in
          the folder itself are not read back.
        </p>
        <Select
          label="Where to publish"
          options={options}
          value={chosen}
          onChange={(e) => setProvider(e.target.value as Provider)}
        />
        {needsUrl ? (
          <TextField
            label="SharePoint folder address"
            hint="Open the folder in SharePoint and paste its address from the browser."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <p className="u-caption u-m-0">Archova creates a folder in your Google Drive.</p>
        )}
        {create.error ? <ErrorAlert error={create.error} /> : null}
        <div>
          <Button type="submit" disabled={needsUrl && !url.trim()} loading={create.isPending}>
            Start publishing
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Project → SharePoint and Drive (integrations/03 M2, 04 G2): where this project's drawings are published, and how it is going. */
export function FolderLinksScreen() {
  const org = useCurrentOrg();
  const links = useFolderLinks();
  const connections = useFolderConnections();
  if (links.isPending || connections.isPending) return <SkeletonRows rows={4} />;
  if (links.error) return <ErrorAlert error={links.error} />;
  if (connections.error) return <ErrorAlert error={connections.error} />;
  const usable = connections.data.data.filter((c) => c.status === 'active').map((c) => c.provider);
  return (
    <div className="stack">
      <PageHeader title="SharePoint and Drive" />
      {usable.length === 0 && links.data.length === 0 ? (
        <Alert tone="info" title="Connect SharePoint or Google Drive first">
          An owner or admin connects them under{' '}
          <a href={webRoutes.folders(org.orgSlug)}>Settings → SharePoint and Drive</a>.
        </Alert>
      ) : null}
      <Card title="Published folders">
        {links.data.length === 0 ? (
          <EmptyState title="Not published anywhere yet" />
        ) : (
          <ul className="folders__list">
            {links.data.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        )}
      </Card>
      <LinkForm providers={usable} taken={links.data.map((l) => l.provider)} />
    </div>
  );
}
