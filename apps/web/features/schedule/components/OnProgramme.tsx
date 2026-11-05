'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useItemPlacements } from '../hooks/useProgramme';

/**
 * On an RFI or submittal page: the programme activities it is tied to (SCH-US10), so the reader sees what is waiting
 * on the answer. Shows nothing when it isn't on a programme or the caller can't read programmes.
 */
export function OnProgramme({
  kind,
  itemId,
  headingClass = 'panel-heading',
}: {
  kind: 'rfi' | 'submittal';
  itemId: string;
  /** The host page's section heading class, so the card matches its neighbours. */
  headingClass?: string;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useItemPlacements(kind, itemId);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="stack" aria-labelledby={`on-programme-${kind}`}>
      <h2 id={`on-programme-${kind}`} className={headingClass}>
        On the programme
      </h2>
      <ul className="activity-links">
        {rows.map((r) => (
          <li key={r.linkId} className="activity-links__row">
            <span>
              <Link className="link" href={webRoutes.programme(org.orgSlug, project.projectId)}>
                {r.activityName}
              </Link>{' '}
              <span className="u-muted">
                ({formatLocalDate(r.start)}
                {r.finish !== r.start ? ` to ${formatLocalDate(r.finish)}` : ''} · {r.scheduleName})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
