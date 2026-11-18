'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonRows, StatusPill, TextField } from '@archova/ui';
import { Search } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { SearchResult } from '../data/api';
import { MIN_QUERY, useSearch } from '../hooks/useSearch';

const TYPES: readonly { type: SearchResult['type']; label: string }[] = [
  { type: 'rfi', label: 'RFIs' },
  { type: 'document', label: 'Documents' },
  { type: 'defect', label: 'Defects' },
  { type: 'submittal', label: 'Submittals' },
  { type: 'correspondence', label: 'Correspondence' },
];

function href(orgSlug: string, r: SearchResult) {
  switch (r.type) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, r.projectId, r.id);
    case 'defect':
      return webRoutes.defect(orgSlug, r.projectId, r.id);
    case 'submittal':
      return webRoutes.submittal(orgSlug, r.projectId, r.id);
    case 'correspondence':
      return webRoutes.correspondenceItem(orgSlug, r.projectId, r.id);
    case 'document':
      return webRoutes.documents(orgSlug, r.projectId);
  }
}

/** Global search: one box across RFIs, documents, defects, submittals and correspondence in every project the person can see. */
export function SearchScreen() {
  const { orgSlug } = useCurrentOrg();
  const [url, setUrl] = useUrlState(['q'] as const);
  const [text, setText] = useState(url.q);
  // The box is the source while typing; the URL follows after a pause so the page can be bookmarked.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== url.q) setUrl({ q: text.trim() ? text : null });
    }, 300);
    return () => clearTimeout(t);
  }, [text, url.q, setUrl]);
  const q = text.trim();
  const search = useSearch(q);
  const ready = q.length >= MIN_QUERY;
  const results = ready ? (search.data?.results ?? []) : [];

  return (
    <div className="stack">
      <PageHeader
        title="Search"
        description="RFIs, documents, defects, submittals and correspondence across your projects. You only see what you can open."
      />
      <TextField
        label="Search"
        type="search"
        autoFocus
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint={`Type at least ${MIN_QUERY} characters.`}
      />
      {!ready ? null : search.isPending ? (
        <SkeletonRows rows={4} />
      ) : search.isError ? (
        <ErrorAlert error={search.error} title="We couldn't run that search" />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description="Nothing you can open matches those words. Try fewer or different words."
        />
      ) : (
        <div className="stack" aria-live="polite">
          {TYPES.map(({ type, label }) => {
            const rows = results.filter((r) => r.type === type);
            if (rows.length === 0) return null;
            return (
              <section key={type} aria-labelledby={`search-${type}`} className="stack">
                <h2 id={`search-${type}`} className="search-group__title">
                  {label}
                </h2>
                <ul className="inbox-list">
                  {rows.map((r) => (
                    <li key={`${r.type}-${r.id}`} className="inbox-list__item">
                      <div className="inbox-list__main">
                        <p>
                          <Link className="link" href={href(orgSlug, r)}>
                            <strong>{r.ref}</strong> {r.title}
                          </Link>
                        </p>
                        <p className="inbox-list__when">{r.projectName}</p>
                      </div>
                      <div className="inbox-list__side">
                        <StatusPill tone="neutral">{r.status.replace(/_/g, ' ')}</StatusPill>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {search.data?.truncated ? (
            <p className="inbox-list__when">
              Showing the first matches of each kind. Add a word to narrow them down.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
