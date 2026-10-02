import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CardProps {
  title?: ReactNode;
  /** Heading level for the title; defaults to h2. */
  headingLevel?: 2 | 3;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Surface for grouped content. With a title, it is a labelled region. */
export function Card({ title, headingLevel = 2, actions, children, className }: CardProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={cx('ac-card', className)} aria-labelledby={title ? headingId : undefined}>
      {title || actions ? (
        <div className="ac-card__header">
          {title ? (
            <Heading id={headingId} className="ac-card__title">
              {title}
            </Heading>
          ) : null}
          {actions ? <div className="ac-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
