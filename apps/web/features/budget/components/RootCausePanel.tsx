'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Select,
  SkeletonRows,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetReviewAdvice } from '../data/api';
import { useAskNovaBudget, useBudget, useCostCodes } from '../hooks/useBudget';
import { aud } from '../lib/money';
import { rootCause, type CauseLine, type CauseNode, type StatusFilter } from '../lib/rootCause';

const W = 720;
const COL_X = [0, 250, 500];
const NODE_W = 14;
const GAP = 8;
const MIN_H = 16;
const CHART_H = 380;

const signed = (cents: number) => aud((cents / 100).toFixed(2));

/** Lay a column of nodes out top to bottom, each as tall as its share of the column, with a minimum so none vanish. */
function layout(nodes: CauseNode[]) {
  const total = nodes.reduce((n, d) => n + Math.abs(d.cents), 0) || 1;
  const room = CHART_H - GAP * Math.max(nodes.length - 1, 0);
  const heights = nodes.map((n) => Math.max(MIN_H, (Math.abs(n.cents) / total) * room));
  const scale = Math.min(1, room / (heights.reduce((a, b) => a + b, 0) || 1));
  let y = 0;
  return nodes.map((n, i) => {
    const h = heights[i]! * scale;
    const box = { node: n, y, h };
    y += h + GAP;
    return box;
  });
}

const flowPath = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2;
  return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
};

/**
 * Where a budget variance comes from. The total breaks down by division, then by cost code, each node sized by its
 * dollar contribution (red over budget, green under). Everything is worked out by code from the budget; Nova only
 * explains the node you pick, and never changes anything.
 */
export function RootCausePanel() {
  const project = useCurrentProject();
  const budget = useBudget(project.projectId);
  const codes = useCostCodes(project.projectId);
  const ask = useAskNovaBudget(project.projectId);
  const [filter, setFilter] = useState<StatusFilter>('over');
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState<BudgetReviewAdvice | null>(null);
  const [question, setQuestion] = useState('');

  const cause = useMemo(
    () => (budget.data && codes.data ? rootCause(budget.data.lines, codes.data, filter) : null),
    [budget.data, codes.data, filter],
  );

  if (budget.isPending || codes.isPending) return <SkeletonRows rows={6} />;
  const err = budget.error ?? codes.error;
  if (err) return <ErrorAlert error={err} title="We couldn't load the budget" />;
  if (!budget.data || !cause) return null;
  if (budget.data.lines.length === 0)
    return (
      <EmptyState
        title="No budget yet"
        description="Add budget lines first. The analysis breaks the variance down from them."
      />
    );

  const divBoxes = layout(cause.divisions);
  const codeBoxes = layout(cause.codes);
  const divY = new Map(divBoxes.map((b) => [b.node.id, b]));
  const sel = [...cause.divisions, ...cause.codes].find((n) => n.id === selected) ?? null;
  const isOn = (n: CauseNode) =>
    !sel || n.id === sel.id || n.parentId === sel.id || n.id === sel.parentId;

  const pick = (id: string) => {
    setSelected((cur) => (cur === id ? null : id));
    setAnswer(null);
    setQuestion('');
  };

  const send = (q: string) => {
    if (!sel) return;
    const about = sel.lineId
      ? `Why is cost code ${sel.label} ${sel.cents < 0 ? 'over' : 'under'} budget by ${signed(Math.abs(sel.cents))}?`
      : `Why is the ${sel.label} division ${sel.cents < 0 ? 'over' : 'under'} budget by ${signed(Math.abs(sel.cents))}?`;
    ask.mutate(
      { question: q ? `${about} ${q}` : about, history: answer?.history ?? [] },
      {
        onSuccess: (a) => {
          setAnswer(a);
          setQuestion('');
        },
      },
    );
  };

  const tone = (c: number) => (c < 0 ? 'rc-node--over' : 'rc-node--under');
  const columns: DataTableColumn<CauseLine>[] = [
    {
      id: 'code',
      header: 'Cost code',
      rowHeader: true,
      sortValue: (l) => l.code,
      cell: (l) => (
        <span className="row-actions">
          <span className="u-mono u-nowrap">{l.code}</span> {l.codeDescription}
        </span>
      ),
    },
    {
      id: 'revised',
      header: 'Revised budget',
      align: 'end',
      sortValue: (l) => Number(l.revised),
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.revised)}</span>,
    },
    {
      id: 'projected',
      header: 'Projected cost',
      align: 'end',
      sortValue: (l) => Number(l.projected),
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.projected)}</span>,
    },
    {
      id: 'variance',
      header: 'Over / under',
      align: 'end',
      sortValue: (l) => l.varianceCents,
      cell: (l) => (
        <span className={`u-mono u-nowrap ${l.varianceCents < 0 ? 'rc-text--over' : ''}`}>
          {aud(l.variance)}
        </span>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <Card>
        <section aria-labelledby="rc-title" className="stack">
          <div>
            <h2 id="rc-title" className="u-m-0">
              Root cause analysis
            </h2>
            <p className="u-m-0 u-caption">
              Projected over/under is the revised budget less the projected cost: the higher of
              committed and actual, plus the forecast to complete. Negative is over budget.
            </p>
          </div>
          <div className="form-row">
            <Select
              label="Budget status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as StatusFilter);
                setSelected(null);
                setAnswer(null);
              }}
              options={[
                { value: 'over', label: 'Over budget' },
                { value: 'under', label: 'Under budget' },
                { value: 'all', label: 'All' },
              ]}
            />
            <div>
              <p className="u-m-0 u-caption">Projected over / under</p>
              <p
                className={`u-m-0 rc-total ${cause.totalCents < 0 ? 'rc-text--over' : ''}`}
                data-testid="rc-total"
              >
                {signed(cause.totalCents)}
              </p>
            </div>
          </div>

          {cause.lines.length === 0 ? (
            <EmptyState
              title="Nothing to show"
              description={
                filter === 'over'
                  ? 'No budget line is projected to go over.'
                  : 'No budget line matches this status.'
              }
            />
          ) : (
            <div className="rc-scroll" tabIndex={0} role="group" aria-label="Variance flow chart">
              <svg
                viewBox={`0 0 ${W} ${CHART_H}`}
                width={W}
                height={CHART_H}
                className="rc-svg"
                role="presentation"
              >
                {codeBoxes.map(({ node, y, h }) => {
                  const d = divY.get(node.parentId!)!;
                  return (
                    <path
                      key={`l_${node.id}`}
                      d={flowPath(COL_X[1]! + NODE_W, d.y + d.h / 2, COL_X[2]!, y + h / 2)}
                      className={`rc-link ${tone(node.cents)} ${isOn(node) ? '' : 'rc-dim'}`}
                      strokeWidth={Math.max(2, h * 0.7)}
                    />
                  );
                })}
                {divBoxes.map(({ node, y, h }) => (
                  <path
                    key={`t_${node.id}`}
                    d={flowPath(COL_X[0]! + NODE_W, CHART_H / 2, COL_X[1]!, y + h / 2)}
                    className={`rc-link ${tone(node.cents)} ${isOn(node) ? '' : 'rc-dim'}`}
                    strokeWidth={Math.max(2, h * 0.7)}
                  />
                ))}
                <g>
                  <rect
                    x={COL_X[0]}
                    y={CHART_H / 2 - 40}
                    width={NODE_W}
                    height={80}
                    className={`rc-node ${tone(cause.totalCents)}`}
                  />
                  <text x={NODE_W + 6} y={CHART_H / 2 - 4} className="rc-label">
                    Project total
                  </text>
                  <text x={NODE_W + 6} y={CHART_H / 2 + 14} className="rc-label rc-label--sub">
                    {signed(cause.totalCents)}
                  </text>
                </g>
                {[
                  ...divBoxes.map((b) => ({ ...b, col: 1 })),
                  ...codeBoxes.map((b) => ({ ...b, col: 2 })),
                ].map(({ node, y, h, col }) => {
                  const clickable = node.level !== 'other';
                  return (
                    <g
                      key={node.id}
                      className={`rc-node-g ${isOn(node) ? '' : 'rc-dim'}`}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-pressed={clickable ? selected === node.id : undefined}
                      aria-label={`${node.label}, ${signed(node.cents)}`}
                      onClick={clickable ? () => pick(node.id) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                pick(node.id);
                              }
                            }
                          : undefined
                      }
                    >
                      <rect
                        x={COL_X[col]}
                        y={y}
                        width={NODE_W}
                        height={h}
                        className={`rc-node ${tone(node.cents)} ${selected === node.id ? 'rc-node--sel' : ''}`}
                      />
                      <text x={COL_X[col]! + NODE_W + 6} y={y + h / 2 - 2} className="rc-label">
                        {node.label.length > 30 ? `${node.label.slice(0, 29)}…` : node.label}
                      </text>
                      <text
                        x={COL_X[col]! + NODE_W + 6}
                        y={y + h / 2 + 13}
                        className="rc-label rc-label--sub"
                      >
                        {signed(node.cents)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          <p className="u-m-0 u-caption">
            Select a division or cost code to see its flow and ask Nova about it. The figures are
            also in the table below.
          </p>
        </section>
      </Card>

      {sel ? (
        <Card>
          <section aria-labelledby="rc-nova-title" className="stack">
            <div className="row-actions">
              <div>
                <h2 id="rc-nova-title" className="u-m-0">
                  Ask Nova about {sel.label}
                </h2>
                <p className="u-m-0 u-caption">
                  {sel.cents < 0 ? 'Over' : 'Under'} budget by {signed(Math.abs(sel.cents))}
                </p>
              </div>
              <Button
                variant="secondary"
                loading={ask.isPending && !question}
                disabled={ask.isPending}
                onClick={() => send('')}
              >
                {answer ? 'Start again' : 'Explain why'}
              </Button>
            </div>
            <ErrorAlert error={ask.error} title="Nova couldn't answer" />
            {answer ? (
              <div className="stack" aria-live="polite">
                <p className="u-m-0">{answer.reply}</p>
                {answer.points.map((p) => (
                  <p key={p.text} className="u-m-0 u-caption">
                    {p.text}
                  </p>
                ))}
                {answer.options.length > 0 ? (
                  <ul className="plain-list">
                    {answer.options.map((o) => (
                      <li key={o.text}>{o.text}</li>
                    ))}
                  </ul>
                ) : null}
                {answer.notes.length > 0 ? (
                  <Alert tone="warning">{answer.notes.join(' ')}</Alert>
                ) : null}
                <p className="u-m-0 u-caption">{answer.disclaimer}</p>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (question.trim()) send(question.trim());
                  }}
                >
                  <Textarea
                    label="Ask a follow-up"
                    value={question}
                    maxLength={900}
                    rows={2}
                    onChange={(e) => setQuestion(e.target.value)}
                    hint="For example: what should I do about it, or is this a pricing or a scope problem?"
                  />
                  <div className="row-actions">
                    <Button
                      type="submit"
                      loading={ask.isPending && !!question}
                      disabled={ask.isPending || !question.trim()}
                    >
                      Ask Nova
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <p className="u-m-0 u-caption">
                Nova explains what is driving this figure and suggests what to look at. She never
                changes the budget. Each answer uses half a Nova credit.
              </p>
            )}
          </section>
        </Card>
      ) : null}

      {cause.lines.length > 0 ? (
        <DataTable
          caption="Variance by cost code"
          columns={columns}
          rows={cause.lines}
          getRowId={(l) => l.id}
          density="compact"
          defaultSort={{ columnId: 'variance', direction: 'asc' }}
        />
      ) : null}
    </div>
  );
}
