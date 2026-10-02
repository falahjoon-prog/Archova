import type { ReactNode } from 'react';

export interface ItemHeaderProps {
  /** Human number, prominent everywhere: RFI-042, DEF-0193 (design 03 §7). */
  number?: ReactNode;
  title: ReactNode;
  status: ReactNode;
  /** "Waiting on: Smith Engineers · J. Smith". */
  ballInCourt?: ReactNode;
  due?: ReactNode;
  /** The one primary action, plus any secondary ones. */
  actions?: ReactNode;
  /** Extra chips (impact, overdue, stage). */
  meta?: ReactNode;
}

/**
 * The Item header shared by RFIs, submittals, defects and variations (design 02 §7.6): number, title, status pill,
 * ball in court, due date and the primary action. Renders the page's h1.
 */
export function ItemHeader({
  number,
  title,
  status,
  ballInCourt,
  due,
  actions,
  meta,
}: ItemHeaderProps) {
  return (
    <header className="ac-item-header">
      <div className="ac-item-header__main">
        {number ? <p className="ac-item-header__number">{number}</p> : null}
        <h1 className="ac-item-header__title">{title}</h1>
        <div className="ac-item-header__meta">
          {status}
          {ballInCourt ? <span className="ac-item-header__bic">{ballInCourt}</span> : null}
          {due ? <span className="ac-item-header__due">{due}</span> : null}
          {meta}
        </div>
      </div>
      {actions ? <div className="ac-item-header__actions">{actions}</div> : null}
    </header>
  );
}
