import { useId, type SVGProps } from 'react';

export interface NovaMarkProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Pixel size. */
  size?: number;
  /** Ignored: the mark has its own colours. Accepted so it can stand in for the old line icon. */
  strokeWidth?: number | string;
}

/**
 * The Archova Nova mark: an "N" built from stone blocks like the Keystone logo, slate stones (`--c-ai`, lighter on
 * dark) with an amber keystone (brand/nova-mark README). Use it only where content comes from Nova. Hidden from
 * assistive tech unless a label is passed.
 */
export function NovaMark({ size = 20, strokeWidth: _strokeWidth, ...rest }: NovaMarkProps) {
  const id = useId();
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
      <defs>
        <mask id={id}>
          <rect width="64" height="64" fill="#fff" />
          <polygon
            points="2.2,-1.6 13.2,-1.6 60.8,65.6 49.8,65.6"
            fill="#000"
            stroke="#000"
            strokeWidth="5"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${id})`} fill="var(--c-ai, #2C4458)">
        <rect x="9" y="8" width="11" height="48" rx="1.5" />
        <rect x="44" y="8" width="11" height="48" rx="1.5" />
      </g>
      <g fill="var(--c-ai, #2C4458)">
        <polygon points="9,8 20,8 30.5,22.9 19.5,22.9" />
        <polygon points="32.5,41.1 43.5,41.1 54,56 43,56" />
      </g>
      <polygon
        points="20.7,24.6 31.7,24.6 42.3,39.4 31.3,39.4"
        fill="var(--brand-amber, #E08A1E)"
      />
    </svg>
  );
}
