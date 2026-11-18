'use client';

import type { LucideIcon } from '@archova/ui/icons';
import { Button, DataTable, EmptyState, SkeletonRows, type DataTableColumn } from '@archova/ui';
import { ErrorAlert } from './ErrorAlert';

/**
 * The recycle bin pattern for any soft-deleted record: a table of what was deleted, each with Restore.
 * The API side is `DELETE /x/{id}` (soft delete), `GET /x/bin`, `POST /x/{id}/restore` (docs/architecture/conventions.md
 * §Recycle bin). Pass the module's own columns; the Restore column is added here.
 */
export function RecycleBin<T>({
  caption,
  columns,
  rows,
  loading,
  error,
  getRowId,
  getLabel,
  onRestore,
  restoringId,
  icon,
  emptyTitle = 'The recycle bin is empty',
  emptyDescription = 'Deleted items stay here until you restore them.',
}: {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  loading: boolean;
  error: unknown;
  getRowId: (row: T) => string;
  /** Names the row for the Restore button's accessible label. */
  getLabel: (row: T) => string;
  onRestore: (row: T) => void;
  restoringId?: string | null;
  icon: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <>
      <ErrorAlert error={error} title="We couldn't load the recycle bin" />
      {loading ? (
        <SkeletonRows label="Loading the recycle bin…" />
      ) : (
        <DataTable
          caption={caption}
          columns={[
            ...columns,
            {
              id: 'restore',
              header: <span className="u-visually-hidden">Restore</span>,
              cell: (row) => (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={restoringId === getRowId(row)}
                  aria-label={`Restore ${getLabel(row)}`}
                  onClick={() => onRestore(row)}
                >
                  Restore
                </Button>
              ),
            },
          ]}
          rows={rows ?? []}
          getRowId={getRowId}
          empty={<EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />}
        />
      )}
    </>
  );
}
