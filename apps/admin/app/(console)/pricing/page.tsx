'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import type {
  PlanDto,
  PriceBookDto,
  PriceBookPreview,
  PriceInput,
  PriceUnit,
} from '@archova/contracts';
import { api } from '@/shared/api';
import { PriceChanges } from '@/shared/PriceChanges';
import { ReasonDialog } from '@/shared/ReasonDialog';
import { can, useStaff } from '@/shared/staff';
import {
  STATUS_LABEL,
  fromDateInput,
  formatDate,
  formatPrice,
  statusTone,
  toDateInput,
} from '@/shared/format';

type Unit = PriceUnit | 'not_sold';
interface Row {
  planCode: string;
  name: string;
  unit: Unit;
  fromPrice: boolean;
  dollars: string;
}

const UNITS: Array<{ value: Unit; label: string }> = [
  { value: 'not_sold', label: 'Not sold' },
  { value: 'free', label: 'Free' },
  { value: 'user_month', label: 'Per user, per month' },
  { value: 'year', label: 'Per year' },
];

const toRows = (book: PriceBookDto, plans: PlanDto[]): Row[] =>
  plans.map((p) => {
    const price = book.prices.find((x) => x.planCode === p.code);
    return {
      planCode: p.code,
      name: p.published?.name ?? p.draft?.name ?? p.code,
      unit: price?.unit ?? 'not_sold',
      fromPrice: price?.fromPrice ?? false,
      dollars:
        price?.amountCents !== undefined && price.amountCents !== null
          ? String(price.amountCents / 100)
          : '',
    };
  });

function toPrices(rows: Row[]): { prices: PriceInput[]; error: string | null } {
  const prices: PriceInput[] = [];
  for (const r of rows) {
    if (r.unit === 'not_sold') continue;
    if (r.unit === 'free') {
      prices.push({ planCode: r.planCode, unit: 'free', fromPrice: false, amountCents: null });
      continue;
    }
    const n = Number(r.dollars);
    if (r.dollars.trim() === '' || !Number.isFinite(n) || n < 0)
      return { prices, error: `Enter a price in dollars for ${r.name}.` };
    prices.push({
      planCode: r.planCode,
      unit: r.unit,
      fromPrice: r.fromPrice,
      amountCents: Math.round(n * 100),
    });
  }
  return { prices, error: prices.length ? null : 'Price at least one plan.' };
}

function Editor({ book, plans }: { book: PriceBookDto; plans: PlanDto[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => toRows(book, plans));
  const [date, setDate] = useState(toDateInput(book.effectiveFrom));
  const [preview, setPreview] = useState<PriceBookPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(toRows(book, plans));
    setDate(toDateInput(book.effectiveFrom));
    setDirty(false);
  }, [book, plans]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['price-books'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };
  const patch = (code: string, change: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.planCode === code ? { ...r, ...change } : r)));
    setDirty(true);
    setPreview(null);
  };

  async function save() {
    const { prices, error: bad } = toPrices(rows);
    if (bad) throw new Error(bad);
    await api.savePriceBook(book.id, { effectiveFrom: fromDateInput(date), prices });
    setDirty(false);
  }

  const saveAndPreview = useMutation({
    mutationFn: async () => {
      await save();
      return api.previewPriceBook(book.id);
    },
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const discard = useMutation({
    mutationFn: () => api.discardPriceBook(book.id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card title={`Draft ${book.version}`} actions={<StatusPill tone="neutral">Draft</StatusPill>}>
      <div className="stack">
        <div>
          {rows.map((r) => (
            <div key={r.planCode} className="price-row">
              <span className="price-row__plan">{r.name}</span>
              <Select
                label="Billing"
                value={r.unit}
                onChange={(e) => patch(r.planCode, { unit: e.target.value as Unit })}
                options={UNITS}
              />
              <Checkbox
                label="From"
                checked={r.fromPrice}
                disabled={r.unit === 'free' || r.unit === 'not_sold'}
                onChange={(e) => patch(r.planCode, { fromPrice: e.target.checked })}
              />
              <TextField
                label="Price (A$, ex GST)"
                inputMode="decimal"
                value={r.unit === 'free' || r.unit === 'not_sold' ? '' : r.dollars}
                disabled={r.unit === 'free' || r.unit === 'not_sold'}
                onChange={(e) => patch(r.planCode, { dollars: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="form-grid form-grid--2">
          <TextField
            label="Takes effect on"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDirty(true);
              setPreview(null);
            }}
            hint="Sydney time. Leave empty to go live when approved. A price increase needs 60 days' notice."
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {preview ? (
          <div className="stack">
            <PriceChanges
              changes={preview.changes}
              names={Object.fromEntries(rows.map((r) => [r.planCode, r.name]))}
            />
            {preview.problems.map((p) => (
              <Alert key={p} tone="warning">
                {p}
              </Alert>
            ))}
          </div>
        ) : null}
        <div className="row row--end">
          <Button variant="tertiary" onClick={() => discard.mutate()} loading={discard.isPending}>
            Discard draft
          </Button>
          <Button
            variant="secondary"
            onClick={() => saveAndPreview.mutate()}
            loading={saveAndPreview.isPending}
          >
            Save and preview
          </Button>
          <Button
            onClick={() => setSubmitting(true)}
            disabled={dirty || !preview || preview.problems.length > 0}
          >
            Submit for approval
          </Button>
        </div>
      </div>
      <ReasonDialog
        open={submitting}
        title="Submit this price book for approval?"
        description="A second person has to approve it before anything changes for customers."
        confirmLabel="Submit"
        onClose={() => setSubmitting(false)}
        onConfirm={async (reason) => {
          await api.submitPriceBook(book.id, reason);
          refresh();
        }}
      />
    </Card>
  );
}

export default function PricingPage() {
  const staff = useStaff();
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ['price-books'], queryFn: api.priceBooks });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const start = useMutation({
    mutationFn: api.createPriceBook,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['price-books'] }),
  });

  const items = books.data?.items ?? [];
  const live = items.find((b) => b.status === 'published');
  const open = items.find((b) => ['draft', 'pending_approval', 'scheduled'].includes(b.status));
  const planList = useMemo(() => plans.data?.items ?? [], [plans.data]);
  const labelOf = (code: string) => planList.find((p) => p.code === code)?.published?.name ?? code;
  const edit = can(staff, 'backoffice.pricing.edit');

  if (books.isPending || plans.isPending) return <SkeletonRows rows={6} />;
  if (books.isError || plans.isError)
    return (
      <Alert tone="danger" title="Could not load the price book">
        {(books.error ?? plans.error)?.message}
      </Alert>
    );

  return (
    <>
      <PageHeader
        title="Price book"
        description="What each plan costs. The website pricing page reads the live price book; nothing changes for customers until a second person approves."
        actions={
          edit && !open ? (
            <Button onClick={() => start.mutate()} loading={start.isPending}>
              Start a new draft
            </Button>
          ) : undefined
        }
      />
      {start.error ? <Alert tone="danger">{start.error.message}</Alert> : null}
      {live ? (
        <Card
          title={`Live: ${live.version}`}
          actions={<StatusPill tone="success">Live</StatusPill>}
        >
          <DataTable<PriceInput>
            caption="Live prices"
            rows={live.prices}
            getRowId={(p) => p.planCode}
            columns={[
              { id: 'plan', header: 'Plan', rowHeader: true, cell: (p) => labelOf(p.planCode) },
              { id: 'price', header: 'Price (ex GST)', cell: (p) => formatPrice(p) },
            ]}
            footer={
              <tr>
                <td colSpan={2} className="muted">
                  Effective {formatDate(live.effectiveFrom)}
                </td>
              </tr>
            }
          />
        </Card>
      ) : (
        <Alert tone="warning" title="No price book is live">
          The website shows its built-in founding prices until one is published.
        </Alert>
      )}
      {open?.status === 'draft' && edit ? <Editor book={open} plans={planList} /> : null}
      {open && open.status !== 'draft' ? (
        <Alert
          tone="info"
          title={`${open.version} is ${STATUS_LABEL[open.status]!.toLowerCase()}`}
          action={
            open.status === 'pending_approval' ? (
              <Link className="link" href="/approvals">
                Open approvals
              </Link>
            ) : undefined
          }
        >
          {open.status === 'scheduled'
            ? `It goes live on ${formatDate(open.effectiveFrom)}.`
            : 'It cannot be edited while it waits for a decision.'}
        </Alert>
      ) : null}
      <Card title="History">
        <DataTable<PriceBookDto>
          caption="Price book history"
          rows={items}
          getRowId={(b) => b.id}
          columns={[
            { id: 'version', header: 'Version', rowHeader: true, cell: (b) => b.version },
            {
              id: 'status',
              header: 'Status',
              cell: (b) => (
                <StatusPill tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</StatusPill>
              ),
            },
            { id: 'effective', header: 'Effective', cell: (b) => formatDate(b.effectiveFrom) },
            { id: 'published', header: 'Published', cell: (b) => formatDate(b.publishedAt) },
          ]}
        />
      </Card>
    </>
  );
}
