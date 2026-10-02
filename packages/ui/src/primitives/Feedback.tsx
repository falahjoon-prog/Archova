import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/** Placeholder block matching the final layout while data loads (no spinners on full pages, frontend 02 §8). */
export function Skeleton({
  width,
  height = 16,
  className,
}: {
  width?: number | string;
  height?: number;
  className?: string;
}) {
  return (
    <span className={cx('ac-skeleton', className)} style={{ width, height }} aria-hidden="true" />
  );
}

/** Rows of skeleton lines for a loading list or table, announced once as "Loading…". */
export function SkeletonRows({ rows = 5, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="ac-skeleton-rows" role="status">
      <span className="ac-visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={20} width={`${90 - (i % 3) * 15}%`} />
      ))}
    </div>
  );
}

/** Inline spinner for actions under a second. */
export function Spinner({ label = 'Working…' }: { label?: string }) {
  return (
    <span className="ac-spinner" role="status">
      <span className="ac-spinner__ring" aria-hidden="true" />
      <span className="ac-visually-hidden">{label}</span>
    </span>
  );
}

/** Visually hidden text for screen readers. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ac-visually-hidden">{children}</span>;
}
