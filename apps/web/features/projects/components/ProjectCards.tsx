import Link from 'next/link';
import type { Project } from '@archova/contracts';
import type { ProjectStatus } from '@archova/domain';
import { StatusPill, type StatusTone } from '@archova/ui';
import { MapPin } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { AU_STATE_NAMES, isAuState, statusLabel } from '../lib/labels';

const STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  active: 'success',
  tender: 'info',
  on_hold: 'warning',
  closed: 'neutral',
  archived: 'neutral',
};

/**
 * The projects in one organisation as cards: name (the whole card is the link), job number, state and status.
 * One column on a phone, two on a tablet, three on a desktop.
 */
export function ProjectCards({
  orgSlug,
  projects,
}: {
  orgSlug: string;
  projects: readonly Project[];
}) {
  return (
    <ul className="project-grid" aria-label="Projects">
      {projects.map((p) => (
        <li key={p.id} className="project-card">
          <div className="project-card__top">
            <span className="project-card__number u-mono">{p.number ?? 'No job number'}</span>
            <StatusPill tone={STATUS_TONE[p.status]}>{statusLabel(p.status)}</StatusPill>
          </div>
          <h2 className="project-card__name">
            <Link className="project-card__link" href={webRoutes.project(orgSlug, p.id)}>
              {p.name}
            </Link>
          </h2>
          <p className="project-card__meta">
            <MapPin size={16} aria-hidden="true" />
            {p.state && isAuState(p.state) ? AU_STATE_NAMES[p.state] : 'State not set'}
          </p>
        </li>
      ))}
    </ul>
  );
}
