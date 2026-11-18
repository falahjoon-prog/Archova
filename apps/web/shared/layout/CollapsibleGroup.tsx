'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from '@archova/ui/icons';

const STORAGE_PREFIX = 'archova.groups.';

/**
 * Remembered open/closed state for a set of collapsible groups, kept per browser under `scope` (a preference,
 * not data). Groups default to open; reads and writes are guarded because storage can be blocked.
 */
export function useGroupState(scope: string) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + scope);
      if (raw) setClosed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage blocked: everything stays open */
    }
    setReady(true);
  }, [scope]);
  const persist = useCallback(
    (next: Set<string>) => {
      setClosed(next);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
    },
    [scope],
  );
  const toggle = (id: string) => {
    const next = new Set(closed);
    if (!next.delete(id)) next.add(id);
    persist(next);
  };
  const open = (id: string) => {
    if (!closed.has(id)) return;
    const next = new Set(closed);
    next.delete(id);
    persist(next);
  };
  const setAll = (ids: readonly string[], open: boolean) =>
    persist(open ? new Set() : new Set(ids));
  return { isOpen: (id: string) => !closed.has(id), toggle, open, setAll, ready };
}

/**
 * A header button that opens and closes its content. A closed group shows an item count and, when `hasCurrent`,
 * a dot so the current page is still findable. `variant` only changes styling hooks.
 */
export function CollapsibleGroup({
  label,
  icon: Icon,
  count,
  open,
  onToggle,
  hasCurrent,
  variant,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  count: number;
  open: boolean;
  onToggle: () => void;
  hasCurrent?: boolean;
  variant: 'nav' | 'panel';
  children: ReactNode;
}) {
  const regionId = useId();
  return (
    <div className={`cgroup cgroup--${variant}`} data-open={open}>
      <button
        type="button"
        className="cgroup__header ac-focusable"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        {Icon && variant === 'panel' ? (
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        ) : null}
        <span className="cgroup__label">{label}</span>
        {!open ? <span className="cgroup__count">{count}</span> : null}
        {!open && hasCurrent ? (
          <span className="cgroup__dot" role="img" aria-label="Current page is in this group" />
        ) : null}
        <ChevronDown className="cgroup__chevron" size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div id={regionId} className="cgroup__body">
        {children}
      </div>
    </div>
  );
}
