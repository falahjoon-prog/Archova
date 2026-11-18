'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Checkbox, EmptyState, SegmentBar, Select } from '@archova/ui';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import type { Portfolio } from '../lib/types';
import {
  DEFAULT_LAYOUT,
  FILTERS_OVERDUE,
  MODULE_DUE_NOTES,
  MODULE_LABELS,
  OVERVIEW_MODULES,
  applyLayout,
  cleanLayout,
  moduleHref,
  moveModule,
  overviewRows,
  toggleModule,
  type OverviewLayout,
} from '../lib/overviewTable';

const KEY = (projectId: string) => `archova.overview-rows.${projectId}`;

// The row choice is a per-person convenience, so it lives in this browser only and the page works without it.
function load(projectId: string): OverviewLayout {
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    return raw ? cleanLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}
function save(projectId: string, layout: OverviewLayout | null) {
  try {
    if (layout) window.localStorage.setItem(KEY(projectId), JSON.stringify(layout));
    else window.localStorage.removeItem(KEY(projectId));
  } catch {
    /* storage can be blocked; the choice then lasts until the page closes */
  }
}

/** One project, one row per tool: what is overdue, due in the next 7 days and due later. */
export function ProjectOverviewTable({ portfolio }: { portfolio: Portfolio }) {
  const org = useCurrentOrg();
  const [projectId, setProjectId] = useState(portfolio.projects[0]?.id ?? '');
  const project = portfolio.projects.find((p) => p.id === projectId) ?? portfolio.projects[0];
  const id = project?.id ?? '';
  const [layout, setLayout] = useState<OverviewLayout>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (id) setLayout(load(id));
  }, [id]);

  const all = useMemo(() => (project ? overviewRows(project) : []), [project]);
  const rows = applyLayout(all, layout);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + pick(r), 0);

  if (!project) {
    return (
      <EmptyState
        title="No projects yet"
        description="Projects you can see appear here with their open items by due date."
      />
    );
  }
  const change = (next: OverviewLayout | null) => {
    setLayout(next ?? DEFAULT_LAYOUT);
    save(id, next);
  };

  return (
    <div className="stack-lg">
      <Select
        label="Project"
        value={id}
        onChange={(e) => setProjectId(e.target.value)}
        options={portfolio.projects.map((p) => ({ value: p.id, label: p.name }))}
      />
      <Card
        title="Open items by due date"
        actions={
          <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Choose rows'}
          </Button>
        }
      >
        <div className="stack">
          {editing ? (
            <div className="stack">
              <ul className="overview-rows__edit" aria-label="Rows to show, in order">
                {layout.order.map((key, i) => (
                  <li key={key}>
                    <Checkbox
                      label={MODULE_LABELS[key]}
                      checked={!layout.hidden.includes(key)}
                      onChange={() => change(toggleModule(layout, key))}
                    />
                    <Button
                      variant="secondary"
                      aria-label={`Move ${MODULE_LABELS[key]} up`}
                      disabled={i === 0}
                      onClick={() => change(moveModule(layout, key, -1))}
                    >
                      <span aria-hidden="true">↑</span>
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Move ${MODULE_LABELS[key]} down`}
                      disabled={i === OVERVIEW_MODULES.length - 1}
                      onClick={() => change(moveModule(layout, key, 1))}
                    >
                      <span aria-hidden="true">↓</span>
                    </Button>
                  </li>
                ))}
              </ul>
              <div>
                <Button variant="secondary" onClick={() => change(null)}>
                  Reset rows
                </Button>
              </div>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No rows chosen" description="Choose at least one tool to show." />
          ) : (
            <div className="overview-table__wrap">
              <table className="overview-table">
                <caption className="ac-visually-hidden">
                  Open items on {project.name} by tool and due date
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col" className="overview-table__bar">
                      Split
                    </th>
                    <th scope="col">Overdue</th>
                    <th scope="col">Next 7 days</th>
                    <th scope="col">Later</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">
                        <Link className="link" href={moduleHref(r.key, org.orgSlug, id, false)}>
                          {r.label}
                        </Link>
                      </th>
                      {r.restricted ? (
                        <td colSpan={5} className="u-muted">
                          No access
                        </td>
                      ) : (
                        <>
                          <td className="overview-table__bar">
                            <SegmentBar
                              max={max}
                              segments={[
                                { label: 'Overdue', value: r.overdue, tone: 'danger' },
                                { label: 'Next 7 days', value: r.next7, tone: 'warning' },
                                { label: 'Later', value: r.later, tone: 'neutral' },
                              ]}
                            />
                          </td>
                          <td className={r.overdue > 0 ? 'overview-table__late' : undefined}>
                            {r.overdue > 0 ? (
                              <Link
                                className="link"
                                href={moduleHref(
                                  r.key,
                                  org.orgSlug,
                                  id,
                                  FILTERS_OVERDUE.includes(r.key),
                                )}
                                aria-label={`${r.overdue} overdue ${r.label}`}
                              >
                                {r.overdue}
                              </Link>
                            ) : (
                              0
                            )}
                          </td>
                          <td>{r.next7}</td>
                          <td>{r.later}</td>
                          <td>{r.total}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All shown</th>
                    <td className="overview-table__bar" />
                    <td>{sum((r) => r.overdue)}</td>
                    <td>{sum((r) => r.next7)}</td>
                    <td>{sum((r) => r.later)}</td>
                    <td>{sum((r) => r.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="u-muted">
            Counts only include what you are allowed to open. {MODULE_DUE_NOTES.rfis}{' '}
            {MODULE_DUE_NOTES.submittals} {MODULE_DUE_NOTES.claims} {MODULE_DUE_NOTES.variations}{' '}
            {MODULE_DUE_NOTES.incidents} Items with no due date count as Later.
          </p>
        </div>
      </Card>
    </div>
  );
}
