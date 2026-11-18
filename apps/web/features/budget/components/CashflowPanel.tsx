'use client';

import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  SkeletonRows,
  StatGrid,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { flagTone, kindLabel, monthLabel, type CashMonth } from '../lib/cashflow';
import { aud, isNegative } from '../lib/money';
import { useCashflow } from '../hooks/useBudget';
import { CashflowChart } from './CashflowChart';

const signedTone = (v: string) => (isNegative(v) ? 'danger' : 'success');

/**
 * Cashflow and work in progress: cash in and out by month from claims, retention, the budget's monthly cost plan and
 * direct costs, and the WIP position (earned against billed). Code works out every figure and every flag; nothing
 * here is typed in.
 */
export function CashflowPanel() {
  const project = useCurrentProject();
  const q = useCashflow(project.projectId);
  if (q.isPending) return <SkeletonRows rows={5} />;
  if (q.error) return <ErrorAlert error={q.error} title="We couldn't load the cashflow" />;
  const { months, wip, flags, totals } = q.data;

  const columns: DataTableColumn<CashMonth>[] = [
    { id: 'month', header: 'Month', rowHeader: true, cell: (m) => monthLabel(m.month) },
    { id: 'kind', header: 'Status', cell: (m) => kindLabel(m.kind) },
    {
      id: 'in',
      header: 'Cash in',
      align: 'end',
      cell: (m) => <span className="u-mono">{aud(m.cashIn)}</span>,
    },
    {
      id: 'out',
      header: 'Cash out',
      align: 'end',
      cell: (m) => <span className="u-mono">{aud(m.cashOut)}</span>,
    },
    {
      id: 'net',
      header: 'Net',
      align: 'end',
      cell: (m) => <span className="u-mono">{aud(m.net)}</span>,
    },
    {
      id: 'cum',
      header: 'Running position',
      align: 'end',
      cell: (m) => <span className="u-mono">{aud(m.cumulative)}</span>,
    },
  ];

  const hasMoney = months.some((m) => m.cashIn !== '0.00' || m.cashOut !== '0.00');
  const flagCard = (
    <Card title="Nova flags">
      {flags.length === 0 ? (
        <p className="u-m-0">Nothing to flag: billing tracks the work and cash stays positive.</p>
      ) : (
        <ul
          className="stack-sm u-m-0"
          aria-label="Cashflow flags"
          style={{ listStyle: 'none', padding: 0 }}
        >
          {flags.map((f) => (
            <li key={f.code}>
              <Alert tone={flagTone(f.severity)} title={f.title}>
                {f.detail}
              </Alert>
            </li>
          ))}
        </ul>
      )}
      <p className="u-m-0 u-muted">
        Code finds these and works out every amount. Open Ask Nova to talk any of them through.
      </p>
    </Card>
  );

  return (
    <div className="stack-lg">
      {flagCard}
      {wip ? (
        <Card title="Work in progress">
          <StatGrid
            items={[
              { label: 'Contract value', value: aud(wip.contractValue) },
              {
                label: 'Percent complete',
                value: `${wip.percentComplete}%`,
                hint: `Cost to date ${aud(wip.costToDate)} of ${aud(wip.estimatedFinalCost)} estimated`,
              },
              { label: 'Earned revenue', value: aud(wip.earnedRevenue) },
              { label: 'Billed to date', value: aud(wip.billed) },
              {
                label: isNegative(wip.overUnderBilled) ? 'Underbilled' : 'Overbilled',
                value: aud(
                  isNegative(wip.overUnderBilled)
                    ? wip.overUnderBilled.slice(1)
                    : wip.overUnderBilled,
                ),
                tone:
                  wip.overUnderBilled === '0.00'
                    ? 'neutral'
                    : isNegative(wip.overUnderBilled)
                      ? 'warning'
                      : 'info',
                hint: 'Billed minus earned',
              },
              {
                label: 'Gross profit',
                value: aud(wip.earnedGrossProfit),
                tone: signedTone(wip.earnedGrossProfit),
                hint: `${aud(wip.projectedGrossProfit)} projected at completion`,
              },
              {
                label: 'Owed by client',
                value: aud(wip.receivableOpen),
                hint: 'Claims awaiting payment',
              },
              { label: 'Retention held', value: aud(wip.retentionHeld) },
            ]}
          />
        </Card>
      ) : null}
      {hasMoney ? (
        <>
          <Card title="Cash in and out by month" actions={<Badge>Ex GST</Badge>}>
            <StatGrid
              items={[
                { label: 'Received to date', value: aud(totals.cashInToDate) },
                { label: 'Paid out to date', value: aud(totals.cashOutToDate) },
                { label: 'Cash in still to come', value: aud(totals.forecastCashIn) },
                { label: 'Cash out still to go', value: aud(totals.forecastCashOut) },
                {
                  label: 'Lowest position',
                  value: aud(totals.lowestCumulative),
                  tone: isNegative(totals.lowestCumulative) ? 'danger' : 'neutral',
                  hint: totals.lowestMonth ? monthLabel(totals.lowestMonth) : undefined,
                },
              ]}
            />
            <CashflowChart months={months} />
            <p className="u-m-0 u-muted">
              Solid bars are actual, hatched bars are forecast. Blue is cash in, amber is cash out,
              the line is the running position.
            </p>
          </Card>
          <DataTable
            caption="Cashflow by month"
            columns={columns}
            rows={months}
            getRowId={(m) => m.month}
            density="compact"
          />
        </>
      ) : (
        <EmptyState
          title="No cash movements yet"
          description="Claims, direct costs and the monthly cost forecast under Forecasting feed this view."
        />
      )}
    </div>
  );
}
