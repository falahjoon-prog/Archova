'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { Card, EmptyState, SkeletonRows, StatusPill } from '@archova/ui';
import { Clock } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { RecentView } from '../data/api';
import { useRecents } from '../hooks/useRecents';

const LABEL: Record<RecentView['entityType'], string> = {
  rfi: 'RFI',
  submittal: 'Submittal',
  defect: 'Defect',
  drawing_sheet: 'Drawing',
  meeting: 'Meeting',
};

function target(orgSlug: string, r: RecentView): string {
  switch (r.entityType) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, r.projectId, r.entityId);
    case 'submittal':
      return webRoutes.submittal(orgSlug, r.projectId, r.entityId);
    case 'defect':
      return webRoutes.defect(orgSlug, r.projectId, r.entityId);
    case 'drawing_sheet':
      return webRoutes.drawing(orgSlug, r.projectId, r.entityId);
    case 'meeting':
      return webRoutes.meeting(orgSlug, r.projectId, r.entityId);
  }
}

/** "5 min ago", "2 h ago", "3 d ago": coarse on purpose, the list is ordered by recency anyway. */
export function ago(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The records the person opened lately in this project, newest first (project home). */
export function RecentsCard({ projectId }: { projectId: string }) {
  const { orgSlug } = useCurrentOrg();
  const recents = useRecents(projectId);

  return (
    <Card title="Recents">
      {recents.isPending ? (
        <SkeletonRows rows={3} label="Loading recents…" />
      ) : recents.isError ? (
        <ErrorAlert error={recents.error} title="We couldn't load your recents" />
      ) : recents.data.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing opened yet"
          description="RFIs, submittals, defects, drawings and meetings you open in this project show up here."
        />
      ) : (
        <ul className="inbox-list">
          {recents.data.map((r) => (
            <li key={`${r.entityType}:${r.entityId}`} className="inbox-list__item">
              <div className="inbox-list__main">
                <p className="inbox-list__title">
                  <Link className="link" href={target(orgSlug, r)}>
                    {r.title}
                  </Link>
                </p>
                <p className="inbox-list__body">
                  {r.subtitle ? `${r.subtitle} · ` : ''}
                  {ago(r.viewedAt)}
                </p>
              </div>
              <div className="inbox-list__side">
                <StatusPill tone="neutral">{LABEL[r.entityType]}</StatusPill>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
