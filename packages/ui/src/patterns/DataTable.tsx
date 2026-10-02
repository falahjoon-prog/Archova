'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Enables sorting on this column. Strings sort with `localeCompare`, numbers numerically, nulls last. */
  sortValue?: (row: Row) => string | number | null;
  align?: 'start' | 'end';
  /** The first column can be a row header (`<th scope="row">`), e.g. the item number. */
  rowHeader?: boolean;
  className?: string;
}

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  /** Names the table for screen readers (visually hidden caption). */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Shown instead of the table body when there are no rows. */
  empty?: ReactNode;
  /** Initial sort; sorting is local to the rows passed in. */
  defaultSort?: SortState;
  /** Keeps the first column visible while scrolling sideways (quote comparison). */
  stickyFirstColumn?: boolean;
  density?: 'compact' | 'comfortable';
  rowClassName?: (row: Row) => string | undefined;
  footer?: ReactNode;
}

/**
 * Register table (design 02 §7.4): sticky header, sortable columns announced with `aria-sort`, compact or
 * comfortable density. Data comes in through props; virtualisation for 10k+ rows is added when the API's cursor
 * pagination is wired (frontend 02 §2).
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  empty,
  defaultSort,
  stickyFirstColumn,
  density = 'comfortable',
  rowClassName,
  footer,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState | undefined>(defaultSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'en-AU', { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);

  const toggleSort = (columnId: string) =>
    setSort((s) =>
      s?.columnId === columnId
        ? { columnId, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { columnId, direction: 'asc' },
    );

  return (
    <div className={cx('ac-table-wrap', stickyFirstColumn && 'ac-table-wrap--sticky-first')}>
      <table className={cx('ac-table', `ac-table--${density}`)}>
        <caption className="ac-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.columnId === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  className={cx(c.align === 'end' && 'ac-table__num', c.className)}
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="ac-table__sort ac-focusable"
                      onClick={() => toggleSort(c.id)}
                    >
                      {c.header}
                      <ChevronDown
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className={cx(
                          'ac-table__sort-icon',
                          active && 'is-active',
                          active && sort.direction === 'asc' && 'is-asc',
                        )}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="ac-table__empty">
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={getRowId(row)} className={rowClassName?.(row)}>
                {columns.map((c) => {
                  const Cell = c.rowHeader ? 'th' : 'td';
                  return (
                    <Cell
                      key={c.id}
                      scope={c.rowHeader ? 'row' : undefined}
                      className={cx(c.align === 'end' && 'ac-table__num', c.className)}
                    >
                      {c.cell(row)}
                    </Cell>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
