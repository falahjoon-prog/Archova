'use client';

import Link from 'next/link';
import {
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  buttonClassName,
  type StatusTone,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { CatalogueEntry } from '../data/api';
import { useCatalogue } from '../hooks/useCatalogue';

const STATUS: Record<CatalogueEntry['status'], { tone: StatusTone; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  available: { tone: 'neutral', label: 'Not connected' },
  needs_attention: { tone: 'danger', label: 'Needs attention' },
  not_configured: { tone: 'neutral', label: 'Not set up' },
  coming_soon: { tone: 'info', label: 'Coming soon' },
};

const CATEGORIES: { key: CatalogueEntry['category']; title: string }[] = [
  { key: 'accounting', title: 'Accounting' },
  { key: 'files', title: 'Files and drawings' },
  { key: 'developer', title: 'Developers and automation' },
];

function route(orgSlug: string, manage: NonNullable<CatalogueEntry['manage']>) {
  if (manage === 'accounting') return webRoutes.accounting(orgSlug);
  if (manage === 'folders') return webRoutes.folders(orgSlug);
  return webRoutes.apiAccess(orgSlug);
}

function EntryCard({ entry }: { entry: CatalogueEntry }) {
  const { orgSlug } = useCurrentOrg();
  const status = STATUS[entry.status];
  const openable = entry.manage !== null && entry.status !== 'not_configured';
  return (
    <Card title={entry.name} actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>}>
      <div className="stack">
        <p className="u-m-0">{entry.summary}</p>
        {entry.detail ? <p className="u-caption u-m-0">{entry.detail}</p> : null}
        {openable && entry.manage ? (
          <div>
            <Link
              className={buttonClassName(entry.status === 'connected' ? 'secondary' : 'primary')}
              href={route(orgSlug, entry.manage)}
              aria-label={`${entry.status === 'connected' ? 'Manage' : 'Set up'} ${entry.name}`}
            >
              {entry.status === 'connected' ? 'Manage' : 'Set up'}
            </Link>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Settings → Integrations (integrations/06 §4): every connector, grouped, with live status. */
export function MarketplaceScreen() {
  const catalogue = useCatalogue();
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="Connect Archova to your accounting, files and other tools."
      />
      {catalogue.isPending ? (
        <SkeletonRows rows={4} />
      ) : catalogue.error ? (
        <ErrorAlert error={catalogue.error} />
      ) : catalogue.data.length === 0 ? (
        <EmptyState title="No integrations available" description="Nothing is offered yet." />
      ) : (
        <div className="stack">
          {CATEGORIES.map((c) => {
            const entries = catalogue.data.filter((e) => e.category === c.key);
            if (entries.length === 0) return null;
            return (
              <section key={c.key} aria-labelledby={`mk-${c.key}`} className="stack">
                <h2 id={`mk-${c.key}`} className="panel-heading u-m-0">
                  {c.title}
                </h2>
                <div className="marketplace__grid">
                  {entries.map((e) => (
                    <EntryCard key={e.key} entry={e} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
