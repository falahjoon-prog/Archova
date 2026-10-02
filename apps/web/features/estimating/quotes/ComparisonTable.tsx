'use client';

import { useState } from 'react';
import { Button, StatusPill } from '@archova/ui';
import { companyName } from '@/shared/mocks/directory';
import type { LevelCell, LevelRow, QuoteTotals } from '../lib/levelling';
import type { Quote } from '../lib/quote-types';
import { money, parseDollars } from './money';
import type { SourceTarget } from './SourceDialog';

const FLAG_LABEL = {
  missing: 'Missing',
  excluded: 'Excluded',
  provisional: 'Provisional sum',
  outlier: 'Far from median',
  corrected: 'Corrected',
} as const;

export interface ComparisonTableProps {
  quotes: Quote[];
  rows: LevelRow[];
  totals: QuoteTotals[];
  normalise: boolean;
  lowestId: string | null;
  awardedId: string | null;
  canSelect: boolean;
  onSelect: (quote: Quote) => void;
  onAllowance: (quoteId: string, scopeKey: string, cents: number | null) => void;
  onSource: (target: SourceTarget) => void;
}

/**
 * The levelled table (frontend 07 §5): scope lines down, one column per confirmed quote, ex GST. Gaps are flagged
 * per cell; with Normalise on the estimator types an allowance into each gap so totals compare like for like.
 */
export function ComparisonTable({
  quotes,
  rows,
  totals,
  normalise,
  lowestId,
  awardedId,
  canSelect,
  onSelect,
  onAllowance,
  onSource,
}: ComparisonTableProps) {
  return (
    <div className="table-wrap comparison-wrap">
      <table className="table comparison">
        <caption className="u-visually-hidden">Quote comparison, amounts ex GST</caption>
        <thead>
          <tr>
            <th scope="col">Scope</th>
            {quotes.map((q, i) => (
              <th key={q.id} scope="col" className="comparison__quote">
                <span>{companyName(q.companyId)}</span>
                <span className="u-caption"> v{q.version}</span>
                <div className="row-actions">
                  {totals[i]!.expired ? (
                    <StatusPill tone="warning">Validity expired</StatusPill>
                  ) : null}
                  {q.id === lowestId ? <StatusPill tone="success">Lowest</StatusPill> : null}
                  {q.id === awardedId ? <StatusPill tone="success">Selected</StatusPill> : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scope.key}>
              <th scope="row">
                {r.scope.description}
                <br />
                <span className="u-caption">
                  {r.scope.quantity ?? '—'} {r.scope.unit}
                </span>
              </th>
              {r.cells.map((c, i) => (
                <td key={c.quoteId} className="ac-table__num">
                  <Cell
                    cell={c}
                    quote={quotes[i]!}
                    scopeKey={r.scope.key}
                    scopeLabel={r.scope.description}
                    normalise={normalise}
                    onAllowance={onAllowance}
                    onSource={onSource}
                  />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Other items in the quote</th>
            {totals.map((t) => (
              <td key={t.quoteId} className="ac-table__num">
                {t.otherLines.length ? (
                  <>
                    {money(t.otherLines.reduce((s, l) => s + l.amountCents, 0))}
                    <br />
                    <span className="u-caption">
                      {t.otherLines.map((l) => l.description).join(', ')}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </td>
            ))}
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total quoted (ex GST)</th>
            {totals.map((t) => (
              <td key={t.quoteId} className="ac-table__num">
                <strong>{money(t.quotedCents)}</strong>
                {t.gaps ? <div className="u-caption">{t.gaps} gaps</div> : null}
              </td>
            ))}
          </tr>
          {normalise ? (
            <tr>
              <th scope="row">Normalised total (ex GST)</th>
              {totals.map((t) => (
                <td key={t.quoteId} className="ac-table__num">
                  <strong>{money(t.normalisedCents)}</strong>
                </td>
              ))}
            </tr>
          ) : null}
          <tr>
            <th scope="row">GST on quoted total</th>
            {totals.map((t) => (
              <td key={t.quoteId} className="ac-table__num">
                {money(t.gstCents)}
              </td>
            ))}
          </tr>
          {canSelect ? (
            <tr>
              <th scope="row">
                <span className="u-visually-hidden">Select</span>
              </th>
              {quotes.map((q) => (
                <td key={q.id} className="ac-table__num">
                  <Button size="sm" variant="secondary" onClick={() => onSelect(q)}>
                    Select {companyName(q.companyId)}
                  </Button>
                </td>
              ))}
            </tr>
          ) : null}
        </tfoot>
      </table>
    </div>
  );
}

function Cell({
  cell,
  quote,
  scopeKey,
  scopeLabel,
  normalise,
  onAllowance,
  onSource,
}: {
  cell: LevelCell;
  quote: Quote;
  scopeKey: string;
  scopeLabel: string;
  normalise: boolean;
  onAllowance: ComparisonTableProps['onAllowance'];
  onSource: ComparisonTableProps['onSource'];
}) {
  const [text, setText] = useState(
    cell.allowanceCents === null ? '' : String(cell.allowanceCents / 100),
  );
  const company = companyName(quote.companyId);
  return (
    <div className="comparison__cell">
      {cell.amountCents !== null ? <span>{money(cell.amountCents)}</span> : null}
      {cell.flags.map((f) => (
        <StatusPill
          key={f}
          tone={
            f === 'missing' || f === 'excluded' ? 'danger' : f === 'corrected' ? 'info' : 'warning'
          }
        >
          {FLAG_LABEL[f]}
        </StatusPill>
      ))}
      {cell.exclusion ? <span className="u-caption">{cell.exclusion}</span> : null}
      {cell.line?.source ? (
        <button
          type="button"
          className="link-button u-caption"
          onClick={() =>
            onSource({
              fileName: quote.fileName,
              label: cell.line!.description,
              ref: cell.line!.source!,
            })
          }
        >
          Source p.{cell.line.source.page}
        </button>
      ) : null}
      {normalise && cell.amountCents === null ? (
        <input
          className="ac-input ac-input--narrow"
          inputMode="decimal"
          aria-label={`Allowance for ${company}: ${scopeLabel}`}
          placeholder="Allowance $"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const cents = parseDollars(text);
            if (cents !== cell.allowanceCents) onAllowance(quote.id, scopeKey, cents);
          }}
        />
      ) : null}
    </div>
  );
}
