'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Star, type LucideIcon } from '@archova/ui/icons';
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

const FAVOURITES_PREFIX = 'archova.favourites.';

/**
 * A person's starred tools, remembered per browser under `scope` (their user id) and keyed by tool label, so the
 * same tools are starred on every project. Storage can be blocked, so reads and writes are guarded.
 */
export function useFavourites(scope: string | undefined) {
  const [labels, setLabels] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!scope) return;
    try {
      const raw = window.localStorage.getItem(FAVOURITES_PREFIX + scope);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed))
        setLabels(parsed.filter((v): v is string => typeof v === 'string'));
    } catch {
      /* storage blocked: nothing starred */
    }
  }, [scope]);
  const toggle = useCallback(
    (label: string) => {
      if (!scope) return;
      setLabels((current) => {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        try {
          window.localStorage.setItem(FAVOURITES_PREFIX + scope, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [scope],
  );
  return { labels, toggle };
}

/** Left sidebar of project tools (design 03 §2-3). No data fetching; the project shell decides what is shown. */
export function ProjectNav({
  projectName,
  groups: allGroups,
  favouritesScope,
}: {
  projectName: string;
  groups: readonly ProjectNavGroup[];
  /** The signed-in user's id; when set, each tool gets a star and starred tools are pinned in a "Starred" group. */
  favouritesScope?: string;
}) {
  const pathname = usePathname();
  const favourites = useFavourites(favouritesScope);
  // A starred tool moves to the pinned group (in the order it was starred) instead of appearing twice.
  const everyItem = allGroups.slice(1).flatMap((g) => g.items);
  const starred = favourites.labels.flatMap((l) => everyItem.find((i) => i.label === l) ?? []);
  // The first group is the project home link, which is always there and never starred.
  const pinnedHome = new Set((allGroups[0]?.items ?? []).map((i) => i.label));
  const starredLabels = new Set(starred.map((i) => i.label));
  const groups: readonly ProjectNavGroup[] = [
    ...allGroups.slice(0, 1),
    ...(starred.length > 0 ? [{ label: 'Starred', items: starred }] : []),
    ...allGroups
      .slice(1)
      .map((g) => ({ ...g, items: g.items.filter((i) => !starredLabels.has(i.label)) }))
      .filter((g) => g.items.length > 0),
  ];
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
          <li key={item.href} className="project-nav__row">
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
            {favouritesScope && !pinnedHome.has(item.label) ? (
              <button
                type="button"
                className="project-nav__star ac-focusable"
                aria-pressed={starredLabels.has(item.label)}
                aria-label={`${starredLabels.has(item.label) ? 'Unstar' : 'Star'} ${item.label}`}
                title={starredLabels.has(item.label) ? 'Remove from starred' : 'Star this tool'}
                onClick={() => favourites.toggle(item.label)}
              >
                <Star size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
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
