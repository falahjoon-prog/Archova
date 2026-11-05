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
export function LinkedIncidentActions({ source }: { source: ActionSource }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useActionsFromSource(source);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
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
