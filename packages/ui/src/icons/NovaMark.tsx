import type { SVGProps } from 'react';

export interface NovaMarkProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Pixel size; the amber spark is dropped under 20 px where it would clutter (brand/nova-mark README). */
  size?: number;
  /** Ignored: the mark has its own colours. Accepted so it can stand in for the old line icon. */
  strokeWidth?: number | string;
}

/**
 * The Archova Nova mark: a four-point star in Nova purple (`--c-ai`, lighter on dark) with one amber spark. Use it
 * only where content comes from Nova. Hidden from assistive tech unless a label is passed.
 */
export function NovaMark({ size = 20, strokeWidth: _strokeWidth, ...rest }: NovaMarkProps) {
  const labelled = rest['aria-label'] !== undefined;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path
        d="M32 8 C34.5 22 42 29.5 56 32 C42 34.5 34.5 42 32 56 C29.5 42 22 34.5 8 32 C22 29.5 29.5 22 32 8 Z"
        fill="var(--c-ai, #6D3FD1)"
      />
      {size >= 20 ? <circle cx="49" cy="15" r="4.5" fill="#E08A1E" /> : null}
    </svg>
  );
}
