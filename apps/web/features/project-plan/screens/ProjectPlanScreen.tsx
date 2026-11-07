'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { ChevronDown, ChevronRight, Lock, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { usePlanInsights, usePlanMutations, useProjectPlan } from '../hooks/useProjectPlan';
import {
  STATUS_LABELS,
  STATUS_TONE,
  TYPE_LABELS,
  progress,
  type LinkType,
  type PlanInsights,
  type PlanItem,
  type PlanPhase,
  type ProjectPlan,
} from '../lib/labels';
import { ItemPanel } from './ItemPanel';

/** The project's action plan: numbered phases of typed items, hold points, links to the records that do the work. */
export function ProjectPlanScreen() {
  const project = useCurrentProject();
  const plan = useProjectPlan();
  const m = usePlanMutations();
  const [params, setParams] = useUrlState(['item'] as const);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'project-plan', id: 'plan' },
  });

  const data = plan.data;
  const selected = data?.phases.flatMap((p) => p.items).find((i) => i.id === params.item) ?? null;

  return (
    <div className="plan">
      <div className="plan__main stack-lg">
        <PageHeader
          eyebrow="Project"
          title="Action plan"
          description="The project from first idea to close-out: phases, the items in each, who is responsible, and the records that do the work. A hold point stops later items being completed until it is cleared."
          actions={
            data?.started && data.canManage ? (
              <AddPhase onAdd={(t) => m.addPhase.mutate(t)} />
            ) : null
          }
        />
        <ErrorAlert
          error={plan.error ?? m.updateItem.error ?? m.clearHold.error}
          title="We couldn't update the action plan"
        />
        {plan.isPending ? (
          <SkeletonRows label="Loading the action plan…" />
        ) : !data ? null : !data.started ? (
          <EmptyState
            title="No action plan yet"
            description="Start from the standard building lifecycle, from feasibility to close-out. Every phase and item can be edited or removed."
            action={
              data.canManage ? (
                <Button onClick={() => m.start.mutate()} disabled={m.start.isPending}>
                  Start from the standard plan
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Insights
              open={(id) => setParams({ item: id })}
              link={(itemId, link) =>
                m.updateItem.mutate({
                  itemId,
                  patch: { links: [{ type: link.type, id: link.id }] },
                })
              }
              plan={data}
            />
            {data.phases.map((phase) => (
              <Phase
                key={phase.id}
                phase={phase}
                selectedId={params.item}
                onOpen={(id) => setParams({ item: id })}
                canManage={data.canManage}
              />
            ))}
          </>
        )}
      </div>
      {selected && data ? (
        <ItemPanel
          key={selected.id}
          item={selected}
          plan={data}
          onClose={() => setParams({ item: '' })}
        />
      ) : null}
    </div>
  );
}

function AddPhase({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" /> Add phase
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a phase"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={title.trim() === ''}
              onClick={() => {
                onAdd(title.trim());
                setTitle('');
                setOpen(false);
              }}
            >
              Add phase
            </Button>
          </>
        }
      >
        <TextField
          label="Phase name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </Dialog>
    </>
  );
}

/** What Nova flags without being asked: overdue and at-risk items, holds holding up work, and likely links. */
function Insights({
  plan,
  open,
  link,
}: {
  plan: ProjectPlan;
  open: (itemId: string) => void;
  link: (itemId: string, l: { type: LinkType; id: string }) => void;
}) {
  const insights = usePlanInsights(true);
  const i: PlanInsights | undefined = insights.data;
  if (
    !i ||
    i.overdue.length + i.atRisk.length + i.blockedByHold.length + i.suggestedLinks.length === 0
  )
    return null;
  const numberOf = (id: string) =>
    plan.phases.flatMap((p) => p.items).find((x) => x.id === id)?.number;
  return (
    <Card>
      <section className="stack" aria-labelledby="plan-nova">
        <h2 id="plan-nova" className="plan__nova-title">
          Nova flags
        </h2>
        <ul className="plan__flags">
          {i.blockedByHold.map((b) => (
            <li key={b.holdItemId}>
              <StatusPill tone="danger">Hold point</StatusPill>{' '}
              <button type="button" className="link-button" onClick={() => open(b.holdItemId)}>
                {b.number} {b.title}
              </button>{' '}
              is holding up {b.blockedCount} later {b.blockedCount === 1 ? 'item' : 'items'}.
            </li>
          ))}
          {i.overdue.map((o) => (
            <li key={o.itemId}>
              <StatusPill tone="danger">Overdue</StatusPill>{' '}
              <button type="button" className="link-button" onClick={() => open(o.itemId)}>
                {o.number} {o.title}
              </button>{' '}
              is {o.daysLate} {o.daysLate === 1 ? 'day' : 'days'} late.
            </li>
          ))}
          {i.atRisk.map((o) => (
            <li key={o.itemId}>
              <StatusPill tone="warning">Due soon</StatusPill>{' '}
              <button type="button" className="link-button" onClick={() => open(o.itemId)}>
                {o.number} {o.title}
              </button>{' '}
              {o.daysLeft === 0
                ? 'is due today.'
                : `is due in ${o.daysLeft} ${o.daysLeft === 1 ? 'day' : 'days'}.`}
            </li>
          ))}
          {plan.canManage
            ? i.suggestedLinks.map((s) => (
                <li key={`${s.itemId}:${s.link.id}`}>
                  <StatusPill tone="ai">Suggested link</StatusPill> {numberOf(s.itemId) ?? s.number}{' '}
                  {s.itemTitle} looks like <strong>{s.link.ref}</strong> {s.link.title}.{' '}
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Link ${s.link.ref} to ${s.number} ${s.itemTitle}`}
                    onClick={() => link(s.itemId, { type: s.link.type, id: s.link.id })}
                  >
                    Link it
                  </Button>
                </li>
              ))
            : null}
        </ul>
      </section>
    </Card>
  );
}

function Phase({
  phase,
  selectedId,
  onOpen,
  canManage,
}: {
  phase: PlanPhase;
  selectedId: string;
  onOpen: (id: string) => void;
  canManage: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const m = usePlanMutations();
  const p = progress(phase);
  const bodyId = `phase-${phase.id}`;
  return (
    <section className="plan-phase" aria-label={`Phase ${phase.number} ${phase.title}`}>
      <header className="plan-phase__head">
        <button
          type="button"
          className="plan-phase__toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? (
            <ChevronRight size={18} aria-hidden="true" />
          ) : (
            <ChevronDown size={18} aria-hidden="true" />
          )}
          <span className="u-mono">{phase.number}</span>
          <span className="plan-phase__title">{phase.title}</span>
        </button>
        <span className="u-caption">
          {p.done} of {p.total} complete
        </span>
        <div className="plan-phase__bar" role="img" aria-label={`${p.pct}% complete`}>
          <span style={{ width: `${p.pct}%` }} />
        </div>
        <Button
          size="sm"
          variant="nova"
          onClick={async () => setSummary(await m.summary.mutateAsync(phase.id))}
          disabled={m.summary.isPending}
        >
          Draft summary
        </Button>
      </header>
      <div id={bodyId} hidden={collapsed}>
        {phase.items.length === 0 ? (
          <p className="u-caption plan-phase__empty">No items in this phase yet.</p>
        ) : (
          <ul className="plan-items">
            {phase.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
        {canManage ? <AddItem phaseId={phase.id} /> : null}
      </div>
      <Dialog
        open={summary !== null}
        onClose={() => setSummary(null)}
        title={`Phase ${phase.number} summary`}
        description="Drafted from the items in this phase. It states facts only; edit it before it goes in a report."
        footer={
          <>
            <Button variant="tertiary" onClick={() => setSummary(null)}>
              Close
            </Button>
            <Button onClick={() => void navigator.clipboard?.writeText(summary ?? '')}>Copy</Button>
          </>
        }
      >
        <p className="u-prewrap">{summary}</p>
      </Dialog>
    </section>
  );
}

function ItemRow({
  item,
  selected,
  onOpen,
}: {
  item: PlanItem;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const blocked = item.blockedBy.length > 0;
  return (
    <li className={`plan-item${selected ? ' plan-item--selected' : ''}`}>
      <span className="u-mono plan-item__no">{item.number}</span>
      <div className="plan-item__main">
        <button
          type="button"
          className="link-button plan-item__title"
          onClick={() => onOpen(item.id)}
        >
          {item.title}
        </button>
        {item.outcome ? <span className="u-caption">{item.outcome}</span> : null}
        {blocked ? (
          <span className="u-caption plan-item__blocked">
            <Lock size={12} aria-hidden="true" /> Waiting on hold point {item.blockedBy[0]!.number}
          </span>
        ) : null}
      </div>
      <div className="plan-item__due">
        {item.dueDate ? (
          item.isOverdue ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(item.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(item.dueDate)
          )
        ) : (
          <span className="u-muted">No date</span>
        )}
      </div>
      <ul className="plan-item__parties" aria-label="Responsible">
        {item.parties.map((p, n) => (
          <li key={n}>
            {p.confirmed ? '✓ ' : ''}
            {p.kind === 'internal' ? 'Internal' : '3rd party'}
            {p.label ? ` · ${p.label}` : ''}
            {p.userIds.length ? ` (${p.userIds.length})` : ''}
          </li>
        ))}
      </ul>
      <ul className="plan-item__types" aria-label="Type">
        {item.types.map((t) => (
          <li key={t}>
            {t === 'hold_point' ? (
              <StatusPill tone={item.holdCleared ? 'success' : 'danger'}>
                {TYPE_LABELS[t]}
                {item.holdCleared ? ' cleared' : ''}
              </StatusPill>
            ) : (
              TYPE_LABELS[t]
            )}
          </li>
        ))}
      </ul>
      <div className="plan-item__status">
        <StatusPill tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</StatusPill>
        {item.requests.filter((r) => r.status === 'open').length ? (
          <span className="u-caption">
            {item.requests.filter((r) => r.status === 'open').length} requested
          </span>
        ) : null}
      </div>
    </li>
  );
}

function AddItem({ phaseId }: { phaseId: string }) {
  const m = usePlanMutations();
  const [title, setTitle] = useState('');
  return (
    <form
      className="plan-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        m.addItem.mutate({ phaseId, input: { title: title.trim() } });
        setTitle('');
      }}
    >
      <TextField
        label="Add an item"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
      />
      <Button type="submit" variant="secondary" disabled={!title.trim() || m.addItem.isPending}>
        Add
      </Button>
    </form>
  );
}
