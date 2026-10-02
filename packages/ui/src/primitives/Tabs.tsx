'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Optional count shown after the label, e.g. Activity (12). */
  count?: number;
}

export interface TabsProps {
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  children: ReactNode;
}

/**
 * WAI-ARIA tabs with automatic activation: arrow keys move between tabs, Home/End jump. The selected panel is the
 * caller's `children` (item sub-views: Details, Activity, Related; design 02 §7.3).
 */
export function Tabs({ label, tabs, value, onValueChange, children }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );

  const focusTab = (i: number) => {
    const next = tabs[(i + tabs.length) % tabs.length];
    if (!next) return;
    onValueChange(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') focusTab(index + 1);
    else if (e.key === 'ArrowLeft') focusTab(index - 1);
    else if (e.key === 'Home') focusTab(0);
    else if (e.key === 'End') focusTab(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="ac-tabs">
      <div
        role="tablist"
        aria-label={label}
        className="ac-tabs__list"
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              className={cx('ac-tabs__tab', 'ac-focusable')}
              onClick={() => onValueChange(t.id)}
            >
              {t.label}
              {t.count !== undefined ? <span className="ac-tabs__count">{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tabs[index]?.id ?? ''}`}
        className="ac-tabs__panel"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
