'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from '@archova/ui/icons';
import { Badge } from '@archova/ui';

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
  label?: string;
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
  return (
    <nav aria-label={`${projectName} tools`} className="project-nav">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className="project-nav__group">
          {group.label ? <p className="project-nav__group-label">{group.label}</p> : null}
          <ul>
            {group.items.map((item) => {
              const current = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="project-nav__link ac-focusable"
                    aria-current={current ? 'page' : undefined}
                  >
                    <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                    <span className="project-nav__label">{item.label}</span>
                    {item.assignedCount ? (
                      <Badge label={`${item.assignedCount} assigned to you`}>
                        {item.assignedCount}
                      </Badge>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
