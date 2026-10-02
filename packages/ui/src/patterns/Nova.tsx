'use client';

import type { ReactNode } from 'react';
import { FileText, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cx } from '../lib/cx';

export interface Citation {
  id: string;
  /** "A-201 Rev C", "Spec 0331 §2.4", "RFI-042". */
  label: string;
  href: string;
}

/** Source citation chip (design 02 §7.7): links to the drawing, spec clause or record Nova used. */
export function CitationChip({ citation, linkAs }: { citation: Citation; linkAs?: LinkComponent }) {
  const Link = linkAs ?? DefaultLink;
  return (
    <Link href={citation.href} className="ac-citation ac-focusable">
      <FileText size={12} strokeWidth={2} aria-hidden="true" />
      <span>{citation.label}</span>
    </Link>
  );
}

export type LinkComponent = (props: {
  href: string;
  className?: string;
  children: ReactNode;
}) => ReactNode;

function DefaultLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export interface NovaSuggestionProps {
  title?: ReactNode;
  children: ReactNode;
  citations?: readonly Citation[];
  linkAs?: LinkComponent;
  /** Accept / Edit / Discard (or a subset). Nova output never saves itself. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Nova suggestion block (design 02 §7.7): purple left border, "Drafted by Nova" label, source links and the
 * caller's Accept / Edit / Discard actions. It never auto-saves (principle P6).
 */
export function NovaSuggestion({
  title,
  children,
  citations,
  linkAs,
  actions,
  className,
}: NovaSuggestionProps) {
  return (
    <section className={cx('ac-nova', className)} aria-label="Drafted by Nova">
      <p className="ac-nova__label">
        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
        Drafted by Nova
      </p>
      {title ? <p className="ac-nova__title">{title}</p> : null}
      <div className="ac-nova__body">{children}</div>
      {citations && citations.length > 0 ? (
        <div className="ac-nova__sources">
          <span className="ac-caption">Sources</span>
          <ul className="ac-nova__source-list">
            {citations.map((c) => (
              <li key={c.id}>
                <CitationChip citation={c} linkAs={linkAs} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {actions ? <div className="ac-nova__actions">{actions}</div> : null}
    </section>
  );
}

/** Thumbs up/down on every Nova output (design 02 §7.7). */
export function NovaFeedback({
  value,
  onChange,
}: {
  value: 'up' | 'down' | null;
  onChange: (value: 'up' | 'down') => void;
}) {
  return (
    <div role="group" aria-label="Was this helpful?" className="ac-nova-feedback">
      <button
        type="button"
        className="ac-icon-button ac-focusable"
        aria-label="Helpful"
        aria-pressed={value === 'up'}
        onClick={() => onChange('up')}
      >
        <ThumbsUp size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="ac-icon-button ac-focusable"
        aria-label="Not helpful"
        aria-pressed={value === 'down'}
        onClick={() => onChange('down')}
      >
        <ThumbsDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
