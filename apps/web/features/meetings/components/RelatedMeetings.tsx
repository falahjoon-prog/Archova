'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useLinkedMeetingItems } from '../hooks/useMeetings';
import { KIND_LABELS } from '../lib/labels';

/** Where a record came up in meeting minutes: the Related tab of an RFI or variation (MTG-AC5). */
export function RelatedMeetings({
  type,
  id,
}: {
  type: 'rfi' | 'defect' | 'variation';
  id: string;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useLinkedMeetingItems(type, id);
  if (q.isPending) return <p className="u-muted">Loading…</p>;
  if (q.error) return <ErrorAlert error={q.error} title="We couldn't load the related meetings" />;
  const rows = q.data ?? [];
  if (rows.length === 0)
    return <p className="u-muted">This has not come up in any meeting minutes.</p>;
  return (
    <ul className="minutes-items" aria-label="Meeting items linked here">
      {rows.map((r) => (
        <li key={`${r.meetingId}-${r.itemNo}`} className="minutes-item">
          <div className="minutes-item__head">
            <span className="u-mono minutes-item__no">{r.itemNo}</span>
            <StatusPill tone={r.kind === 'action' ? 'info' : 'neutral'}>
              {KIND_LABELS[r.kind]}
            </StatusPill>
            {r.kind === 'action' ? (
              <StatusPill tone={r.status === 'open' ? 'warning' : 'success'}>
                {r.status === 'open' ? 'Open' : 'Closed'}
              </StatusPill>
            ) : null}
          </div>
          <p className="minutes-item__body">{r.body}</p>
          <p className="u-caption u-m-0">
            <Link
              className="link"
              href={webRoutes.meeting(org.orgSlug, project.projectId, r.meetingId)}
            >
              {r.meetingTitle}
            </Link>
            , {formatInstant(r.heldAt, project.timezone)}.
            {r.ownerName ? <> Owner: {r.ownerName}.</> : null}
            {r.dueDate ? <> Due {r.dueDate}.</> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
