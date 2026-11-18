'use client';

import { useState } from 'react';
import { Button, Card, Dialog, EmptyState, SkeletonRows } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CostReportColumn } from '../data/api';
import { useCostReport, useCostReportItems } from '../hooks/useBudget';
import { groupLines, isNegative, sumLines, type MoneyKey, type Totals } from '../lib/costReport';
import { aud } from '../lib/money';

const COLUMNS: { key: MoneyKey; label: string; drill?: CostReportColumn }[] = [
  { key: 'original', label: 'Original' },
  { key: 'approvedChanges', label: 'Modifications' },
  { key: 'revised', label: 'Revised' },
  { key: 'approved', label: 'Approved contracts & POs', drill: 'approved' },
  { key: 'pending', label: 'Pending contracts & POs', drill: 'pending' },
  { key: 'nonCommitted', label: 'Non-committed costs', drill: 'direct' },
  { key: 'projected', label: 'Projected cost' },
  { key: 'variance', label: 'Over / under budget' },
];

const DRILL_TITLE: Record<CostReportColumn, string> = {
  approved: 'Approved contracts & POs',
  pending: 'Pending contracts & POs',
  direct: 'Non-committed costs',
};

const Amount = ({ value, red }: { value: string; red?: boolean }) => (
  <span className={`u-mono u-nowrap${red && isNegative(value) ? ' u-danger' : ''}`}>
    {aud(value)}
  </span>
);

/**
 * Per cost code: what is approved, what is waiting for approval, what was spent outside a commitment and the cost
 * that projects to. Each approved, pending and non-committed figure opens the items behind it.
 */
export function CostReportPanel() {
  const project = useCurrentProject();
  const report = useCostReport(project.projectId);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<{ lineId: string; column: CostReportColumn } | null>(null);
  const items = useCostReportItems(project.projectId, target);

  if (report.isPending) return <SkeletonRows rows={5} />;
  if (report.error)
    return <ErrorAlert error={report.error} title="We couldn't load the cost report" />;
  if (!report.data.hasBudget || report.data.lines.length === 0)
    return (
      <EmptyState
        title="No budget lines yet"
        description="Add budget lines and the cost report fills in as commitments and costs arrive."
      />
    );

  const lines = report.data.lines;
  const groups = groupLines(lines);
  const grand = sumLines(lines);
  const toggle = (d: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  const cell = (t: Totals, key: MoneyKey, lineId?: string, drill?: CostReportColumn) => (
    <td key={key} className="ac-table__num">
      {lineId && drill && t[key] !== '0.00' ? (
        <Button
          variant="tertiary"
          aria-label={`${DRILL_TITLE[drill]}, ${lines.find((l) => l.lineId === lineId)?.code}: ${aud(t[key])}`}
          onClick={() => setTarget({ lineId, column: drill })}
        >
          <Amount value={t[key]} />
        </Button>
      ) : (
        <Amount value={t[key]} red={key === 'variance'} />
      )}
    </td>
  );
  const open = target ? lines.find((l) => l.lineId === target.lineId) : null;

  return (
    <Card>
      <section aria-labelledby="cost-report-title" className="stack">
        <div>
          <h2 id="cost-report-title" className="u-m-0">
            Cost report
          </h2>
          <p className="u-m-0 u-caption">
            Pending is submitted contracts and orders waiting for a decision. Non-committed is cost
            recorded without a contract or order. Projected is approved, pending and non-committed
            added together. Select a figure to see what is behind it.
          </p>
        </div>
        <div className="ac-table-wrap">
          <table className="ac-table ac-table--compact">
            <thead>
              <tr>
                <th scope="col">Cost code</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="ac-table__num">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => {
              const shut = closed.has(g.division);
              return (
                <tbody key={g.division}>
                  <tr style={{ fontWeight: 600 }}>
                    <th scope="row">
                      <Button
                        variant="tertiary"
                        aria-expanded={!shut}
                        onClick={() => toggle(g.division)}
                      >
                        {shut ? '▸' : '▾'} Subtotal {g.division}
                      </Button>
                    </th>
                    {COLUMNS.map((c) => cell(g.totals, c.key))}
                  </tr>
                  {shut
                    ? null
                    : g.lines.map((l) => (
                        <tr key={l.lineId}>
                          <th scope="row">
                            <span className="u-mono u-nowrap">{l.code}</span> {l.codeDescription}
                          </th>
                          {COLUMNS.map((c) => cell(l, c.key, l.lineId, c.drill))}
                        </tr>
                      ))}
                </tbody>
              );
            })}
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <th scope="row">Grand total</th>
                {COLUMNS.map((c) => cell(grand, c.key))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={
          target && open
            ? `${DRILL_TITLE[target.column]} for ${open.code} - ${open.codeDescription}`
            : ''
        }
      >
        {items.isPending ? (
          <SkeletonRows rows={3} />
        ) : items.error ? (
          <ErrorAlert error={items.error} title="We couldn't load the items" />
        ) : items.data.groups.length === 0 ? (
          <p className="u-m-0">Nothing is counted here.</p>
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-table--compact">
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="ac-table__num">
                    Amount
                  </th>
                </tr>
              </thead>
              {items.data.groups.map((g) => (
                <tbody key={g.sourceId ?? g.label}>
                  <tr style={{ fontWeight: 600 }}>
                    <th scope="row" colSpan={2}>
                      {g.label}
                    </th>
                    <td className="ac-table__num">
                      <Amount value={g.total} />
                    </td>
                  </tr>
                  {g.items.map((i) => (
                    <tr key={`${g.label}-${i.number}`}>
                      <td>{i.number}</td>
                      <td>{i.description}</td>
                      <td className="ac-table__num">
                        <Amount value={i.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr style={{ fontWeight: 600 }}>
                  <th scope="row" colSpan={2}>
                    Total
                  </th>
                  <td className="ac-table__num">
                    <Amount value={items.data.total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
