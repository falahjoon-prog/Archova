import type { ReactNode } from 'react';

/** Row of filters above a register; filters themselves are plain Select/TextField controls kept in the URL. */
export function FilterBar({
  label = 'Filters',
  children,
  actions,
}: {
  label?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div role="search" aria-label={label} className="ac-filter-bar">
      <div className="ac-filter-bar__filters">{children}</div>
      {actions ? <div className="ac-filter-bar__actions">{actions}</div> : null}
    </div>
  );
}
