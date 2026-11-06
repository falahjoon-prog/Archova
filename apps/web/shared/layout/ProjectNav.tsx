'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from '@archova/ui/icons';
import { Badge } from '@archova/ui';
import { CollapsibleGroup, useGroupState } from './CollapsibleGroup';

export interface ProjectNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Count of open items assigned to me (design 03 §2), not totals. */
  assignedCount?: number;
  /** Matches only the exact path (project home), not sub-paths. */
  exact?: boolean;
}

export interface ProjectNavGroup {
  /** Stable key for remembering open/closed; groups with an `id` and `label` are collapsible. */
  id?: string;
  label?: string;
  icon?: LucideIcon;
  items: readonly ProjectNavItem[];
}

/** Left sidebar of project tools (design 03 §2-3). No data fetching; the project shell decides what is shown. */
export function ProjectNav({
  projectName,
  groups,
}: {
  projectName: string;
  groups: readonly ProjectNavGroup[];
}) {
  const pathname = usePathname();
  const state = useGroupState('sidebar');
  const isCurrent = (item: ProjectNavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  // Arriving on a page (link, back button) opens the group it lives in, even if the user had closed it.
  useEffect(() => {
    if (!state.ready) return;
    for (const g of groups) if (g.id && g.items.some(isCurrent)) state.open(g.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, state.ready]);

  const list = (items: readonly ProjectNavItem[]) => (
    <ul>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className="project-nav__link ac-focusable"
              aria-current={isCurrent(item) ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              <span className="project-nav__label">{item.label}</span>
              {item.assignedCount ? (
                <Badge label={`${item.assignedCount} assigned to you`}>{item.assignedCount}</Badge>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label={`${projectName} tools`} className="project-nav">
      {groups.map((group, gi) =>
        group.id && group.label ? (
          <CollapsibleGroup
            key={group.id}
            variant="nav"
            label={group.label}
            icon={group.icon}
            count={group.items.length}
            open={state.isOpen(group.id)}
            onToggle={() => state.toggle(group.id!)}
            hasCurrent={group.items.some(isCurrent)}
          >
            {list(group.items)}
          </CollapsibleGroup>
        ) : (
          <div key={group.label ?? gi} className="project-nav__group">
            {group.label ? <p className="project-nav__group-label">{group.label}</p> : null}
            {list(group.items)}
          </div>
        ),
      )}
    </nav>
  );
}
