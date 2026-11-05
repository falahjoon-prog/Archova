'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { PROVIDER_NAME, type FolderConnection, type Provider } from '../data/api';
import {
  useDisconnectFolders,
  useFolderConnections,
  useStartFolderConnection,
} from '../hooks/useFolders';
import { RETURN_KEY, type ReturnTo } from './FoldersCallbackScreen';

const STATUS: Record<FolderConnection['status'], { tone: StatusTone; label: string }> = {
  pending: { tone: 'neutral', label: 'Sign-in not finished' },
  active: { tone: 'success', label: 'Connected' },
  error: { tone: 'danger', label: 'Needs reconnecting' },
};

function ProviderCard({
  provider,
  connection,
}: {
  provider: Provider;
  connection: FolderConnection | null;
}) {
  const org = useCurrentOrg();
  const start = useStartFolderConnection();
  const disconnect = useDisconnectFolders(provider);
  const [confirming, setConfirming] = useState(false);
  const [tenant, setTenant] = useState('');
  const name = PROVIDER_NAME[provider];
  const status = connection ? STATUS[connection.status] : null;
  const needsTenant = provider === 'm365';

  function connect(e?: FormEvent) {
    e?.preventDefault();
    start.mutate(
      { provider, ...(needsTenant ? { tenantId: tenant.trim() } : {}) },
      {
        onSuccess: (url) => {
          const back: ReturnTo = { orgId: org.orgId, orgSlug: org.orgSlug };
          try {
            window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(back));
          } catch {
            // Without storage the callback page asks the admin to start again.
          }
          window.location.assign(url);
        },
      },
    );
  }

  return (
    <Card
      title={name}
      actions={status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
    >
      <div className="stack">
        <p className="u-m-0">
          {provider === 'm365'
            ? 'Publish a project’s current drawings to a SharePoint folder. Archova only reaches the sites your Microsoft administrator grants it.'
            : 'Publish a project’s current drawings to a Google Drive folder. Archova only sees the folder and files it creates.'}
        </p>
        {connection?.lastError ? <Alert tone="warning">{connection.lastError}</Alert> : null}
        {!connection || connection.status !== 'active' ? (
          <form className="stack" onSubmit={connect}>
            {needsTenant ? (
              <TextField
                label="Microsoft tenant id or domain"
                hint="For example contoso.onmicrosoft.com. A Microsoft administrator has to approve access."
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
              />
            ) : null}
            <div>
              <Button
                type="submit"
                disabled={needsTenant && !tenant.trim()}
                loading={start.isPending}
              >
                {connection ? `Reconnect ${name}` : `Connect ${name}`}
              </Button>
            </div>
          </form>
        ) : null}
        {start.error ? <ErrorAlert error={start.error} /> : null}
        {disconnect.error ? <ErrorAlert error={disconnect.error} /> : null}
        {connection ? (
          <div className="folders__danger">
            {confirming ? (
              <>
                <p className="u-caption u-m-0">
                  Archova stops publishing and removes every project link. Files already in the
                  folders stay as they are.
                </p>
                <Button
                  variant="danger"
                  loading={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })
                  }
                >
                  Yes, disconnect
                </Button>
                <Button variant="tertiary" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="tertiary" onClick={() => setConfirming(true)}>
                Disconnect {name}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Settings → SharePoint and Drive (integrations/03, 04): connect Microsoft 365 or Google for folder publishing. */
export function FoldersScreen() {
  const connections = useFolderConnections();
  if (connections.isPending) return <SkeletonRows rows={4} />;
  if (connections.error) return <ErrorAlert error={connections.error} />;
  const { data, available } = connections.data;
  const providers = (['m365', 'google'] as const).filter(
    (p) => available.includes(p) || data.some((c) => c.provider === p),
  );
  return (
    <div className="stack">
      <PageHeader title="SharePoint and Drive" />
      {providers.length === 0 ? (
        <Alert tone="info" title="SharePoint and Google Drive are not set up yet">
          Archova support needs to add the connection details for these before you can sign in.
        </Alert>
      ) : (
        providers.map((p) => (
          <ProviderCard
            key={p}
            provider={p}
            connection={data.find((c) => c.provider === p) ?? null}
          />
        ))
      )}
    </div>
  );
}
