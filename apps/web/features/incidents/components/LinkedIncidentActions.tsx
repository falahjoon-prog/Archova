'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { StatusPill } from '@archova/ui';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActionsFromSource } from '../hooks/useIncidents';
import { CORRECTIVE_LABELS, type ActionSource } from '../lib/types';
import { CORRECTIVE_TONE } from '../screens/tones';

/**
 * The corrective actions an incident raised from this inspection or observation. Shows nothing when there are
 * none, or when the caller can't read incidents, so it can sit on any record screen.
 */
export function LinkedIncidentActions({
  source,
  showEmpty = false,
}: {
  source: ActionSource;
  /** Say so when there are none, for a dialog that would otherwise open blank. */
  showEmpty?: boolean;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useActionsFromSource(source);
  const rows = q.data ?? [];
  if (q.isPending && showEmpty) return <p className="u-muted">Loading…</p>;
  if (rows.length === 0)
    return showEmpty ? (
      <p className="u-muted">No incident corrective actions were raised from this.</p>
    ) : null;
  return (
    <section aria-labelledby="linked-incident-actions" className="stack">
      <h2 id="linked-incident-actions">Corrective actions from incidents</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.action.id}>
            <Link href={webRoutes.incidents(org.orgSlug, project.projectId, r.incidentId)}>
              {r.incidentNumberLabel}
            </Link>{' '}
            {r.action.title}{' '}
            <StatusPill tone={CORRECTIVE_TONE[r.action.status]}>
              {CORRECTIVE_LABELS[r.action.status]}
            </StatusPill>
            {r.action.isOverdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
