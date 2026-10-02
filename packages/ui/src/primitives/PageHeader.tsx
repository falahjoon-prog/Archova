import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small text above the title, e.g. a project number. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
}

/** The page's single h1, with optional description and actions. */
export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="ac-page-header">
      <div>
        {eyebrow ? <p className="ac-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="ac-page-header__title">{title}</h1>
        {description ? <p className="ac-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ac-page-header__actions">{actions}</div> : null}
    </header>
  );
}
