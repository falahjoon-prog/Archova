'use client';

import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ToggleOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Accessible name when `label` is an icon only. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Shortcut shown in the tooltip, e.g. "L". */
  shortcut?: string;
}

export interface ToggleGroupProps<V extends string> {
  label: string;
  value: V;
  options: readonly ToggleOption<V>[];
  onValueChange: (value: V) => void;
  className?: string;
}

/** Segmented single-choice control (view mode, drawing tool). Each option is a pressed/unpressed button. */
export function ToggleGroup<V extends string>({
  label,
  value,
  options,
  onValueChange,
  className,
}: ToggleGroupProps<V>) {
  return (
    <div role="group" aria-label={label} className={cx('ac-toggle-group', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ac-toggle-group__item ac-focusable"
          aria-pressed={o.value === value}
          aria-label={o.ariaLabel}
          aria-keyshortcuts={o.shortcut}
          title={o.ariaLabel ? `${o.ariaLabel}${o.shortcut ? ` (${o.shortcut})` : ''}` : undefined}
          disabled={o.disabled}
          onClick={() => onValueChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
