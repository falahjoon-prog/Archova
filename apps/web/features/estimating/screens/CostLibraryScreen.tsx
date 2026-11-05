'use client';

import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { EstimatingIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CostCategory, CostItem } from '../data/estimates-api';
import { useCostItems, useCostLibraryMutations } from '../hooks/useEstimates';
import { CATEGORY_LABELS, dollars, parseRate } from '../lib/estimate-format';

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as CostCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

const BLANK = {
  code: '',
  description: '',
  unit: '',
  trade: '',
  category: 'other' as CostCategory,
  rate: '',
  region: '',
  effectiveFrom: '',
};

/** The company's cost library: items with dated rates that estimate lines are priced from (EST-US10). */
export function CostLibraryScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'cost-library', id: 'list' },
  });
  const [search, setSearch] = useState('');
  const items = useCostItems(search.trim());
  const { create, addRate } = useCostLibraryMutations();
  const today = todayIn(project.timezone);
  const [newItem, setNewItem] = useState<typeof BLANK | null>(null);
  const [repricing, setRepricing] = useState<{
    item: CostItem;
    rate: string;
    from: string;
    region: string;
  } | null>(null);
  const rate = newItem ? parseRate(newItem.rate) : null;

  const columns: DataTableColumn<CostItem>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (i) => i.code.toLowerCase(),
      cell: (i) => <span className="u-mono">{i.code}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      sortValue: (i) => i.description,
      cell: (i) => i.description,
    },
    { id: 'trade', header: 'Trade', sortValue: (i) => i.trade, cell: (i) => i.trade || '—' },
    {
      id: 'category',
      header: 'Type',
      sortValue: (i) => i.category,
      cell: (i) => CATEGORY_LABELS[i.category],
    },
    { id: 'unit', header: 'Unit', cell: (i) => i.unit },
    {
      id: 'rate',
      header: 'Rate ex GST',
      align: 'end',
      sortValue: (i) => (i.currentRate ? Number(i.currentRate.rate) : null),
      cell: (i) =>
        i.currentRate ? (
          <>
            {dollars(i.currentRate.rate)}
            <span className="u-caption"> from {i.currentRate.effectiveFrom}</span>
          </>
        ) : (
          <span className="u-muted">No rate yet</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="ac-visually-hidden">Actions</span>,
      align: 'end',
      cell: (i) => (
        <Button
          size="sm"
          variant="tertiary"
          aria-label={`New rate for ${i.code}`}
          onClick={() => setRepricing({ item: i, rate: '', from: today, region: '' })}
        >
          New rate
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Estimating"
        title="Cost library"
        description="Your own rates by item, kept with their dates. Estimates are priced from here; nothing is priced for you."
        actions={
          <Button onClick={() => setNewItem({ ...BLANK, effectiveFrom: today })}>
            <Plus size={16} aria-hidden="true" /> New item
          </Button>
        }
      />
      {previewDataOnly ? (
        <PreviewDataNotice tool="The cost library" />
      ) : (
        <>
          <TextField
            label="Search code or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ErrorAlert error={items.error} title="We couldn't load the cost library" />
          {items.isPending ? (
            <SkeletonRows label="Loading cost library…" />
          ) : (
            <DataTable
              caption="Cost library"
              columns={columns}
              rows={items.data ?? []}
              getRowId={(i) => i.id}
              defaultSort={{ columnId: 'code', direction: 'asc' }}
              empty={
                <EmptyState
                  icon={EstimatingIcon}
                  title={search ? 'Nothing matches that search' : 'No cost items yet'}
                  description="Add the items you price most often, with a rate and the date it starts."
                />
              }
            />
          )}
        </>
      )}

      <Dialog
        open={newItem !== null}
        onClose={() => setNewItem(null)}
        title="New cost item"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewItem(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !newItem?.code.trim() ||
                !newItem.description.trim() ||
                !newItem.unit.trim() ||
                rate === undefined ||
                create.isPending
              }
              onClick={() =>
                newItem &&
                create.mutate(
                  {
                    code: newItem.code.trim(),
                    description: newItem.description.trim(),
                    unit: newItem.unit.trim(),
                    trade: newItem.trade.trim(),
                    category: newItem.category,
                    ...(rate
                      ? {
                          rate: {
                            rate,
                            effectiveFrom: newItem.effectiveFrom || today,
                            ...(newItem.region.trim() ? { region: newItem.region.trim() } : {}),
                          },
                        }
                      : {}),
                  },
                  { onSuccess: () => setNewItem(null) },
                )
              }
            >
              Add item
            </Button>
          </>
        }
      >
        {newItem ? (
          <div className="stack">
            <div className="form-row">
              <TextField
                label="Code"
                value={newItem.code}
                onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
              />
              <TextField
                label="Unit"
                hint="m, m2, ea, hr…"
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              />
            </div>
            <TextField
              label="Description"
              value={newItem.description}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />
            <div className="form-row">
              <TextField
                label="Trade"
                value={newItem.trade}
                onChange={(e) => setNewItem({ ...newItem, trade: e.target.value })}
              />
              <Select
                label="Type"
                options={CATEGORY_OPTIONS}
                value={newItem.category}
                onChange={(e) =>
                  setNewItem({ ...newItem, category: e.target.value as CostCategory })
                }
              />
            </div>
            <div className="form-row">
              <TextField
                label="Rate ex GST"
                hint="Optional now; add it later with New rate."
                inputMode="decimal"
                value={newItem.rate}
                error={rate === undefined ? 'Enter dollars, e.g. 85.50' : undefined}
                onChange={(e) => setNewItem({ ...newItem, rate: e.target.value })}
              />
              <TextField
                label="Effective from"
                type="date"
                value={newItem.effectiveFrom}
                onChange={(e) => setNewItem({ ...newItem, effectiveFrom: e.target.value })}
              />
            </div>
            <TextField
              label="Region"
              hint="Leave blank for a rate that applies everywhere."
              value={newItem.region}
              onChange={(e) => setNewItem({ ...newItem, region: e.target.value })}
            />
            <ErrorAlert error={create.error} title="We couldn't add the item" />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={repricing !== null}
        onClose={() => setRepricing(null)}
        title={repricing ? `New rate for ${repricing.item.code}` : 'New rate'}
        description="Earlier rates are kept. An estimate uses the latest rate effective on or before its base date."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRepricing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!repricing || !parseRate(repricing.rate) || addRate.isPending}
              onClick={() =>
                repricing &&
                addRate.mutate(
                  {
                    id: repricing.item.id,
                    rate: {
                      rate: parseRate(repricing.rate)!,
                      effectiveFrom: repricing.from || today,
                      ...(repricing.region.trim() ? { region: repricing.region.trim() } : {}),
                    },
                  },
                  { onSuccess: () => setRepricing(null) },
                )
              }
            >
              Save rate
            </Button>
          </>
        }
      >
        {repricing ? (
          <div className="stack">
            <div className="form-row">
              <TextField
                label={`Rate ex GST per ${repricing.item.unit}`}
                inputMode="decimal"
                value={repricing.rate}
                onChange={(e) => setRepricing({ ...repricing, rate: e.target.value })}
              />
              <TextField
                label="Effective from"
                type="date"
                value={repricing.from}
                onChange={(e) => setRepricing({ ...repricing, from: e.target.value })}
              />
            </div>
            <TextField
              label="Region"
              hint="Leave blank for a rate that applies everywhere."
              value={repricing.region}
              onChange={(e) => setRepricing({ ...repricing, region: e.target.value })}
            />
            <ErrorAlert error={addRate.error} title="We couldn't save the rate" />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
