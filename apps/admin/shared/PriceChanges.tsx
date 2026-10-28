import type { PriceBookPreview } from '@archova/contracts';
import { DataTable, StatusPill, type StatusTone } from '@archova/ui';
import { formatPrice } from './format';

const KIND: Record<
  PriceBookPreview['changes'][number]['kind'],
  { label: string; tone: StatusTone }
> = {
  added: { label: 'Added', tone: 'info' },
  removed: { label: 'Removed', tone: 'warning' },
  increase: { label: 'Increase', tone: 'warning' },
  decrease: { label: 'Decrease', tone: 'success' },
  unchanged: { label: 'No change', tone: 'neutral' },
};

type Change = PriceBookPreview['changes'][number];

/** Before and after for each plan: what a price book publish would change (backend 09 §4 step 2). */
const titleCase = (code: string) => code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function PriceChanges({
  changes,
  names = {},
}: {
  changes: Change[];
  names?: Record<string, string>;
}) {
  return (
    <DataTable<Change>
      caption="Price changes"
      rows={changes}
      getRowId={(c) => c.planCode}
      columns={[
        {
          id: 'plan',
          header: 'Plan',
          rowHeader: true,
          cell: (c) => names[c.planCode] ?? titleCase(c.planCode),
        },
        {
          id: 'before',
          header: 'Now',
          cell: (c) => formatPrice(c.before && { unit: c.unit, ...c.before }),
        },
        {
          id: 'after',
          header: 'After',
          cell: (c) => formatPrice(c.after && { unit: c.unit, ...c.after }),
        },
        {
          id: 'kind',
          header: 'Change',
          cell: (c) => <StatusPill tone={KIND[c.kind].tone}>{KIND[c.kind].label}</StatusPill>,
        },
      ]}
    />
  );
}
