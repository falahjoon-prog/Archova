'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  ActivityTimeline,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  ItemHeader,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  buttonClassName,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { Check, ChevronLeft, Eye, Plus, RotateCcw, SwmsIcon, X } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useSwmsDetail, useSwmsList, useSwmsMutations } from '../hooks/useSwms';
import {
  ACTION_LABELS,
  CATEGORIES,
  CATEGORY_LABELS,
  CONTROL_LEVELS,
  CONTROL_LEVEL_LABELS,
  STATUS_LABELS,
  needsReason,
  type Category,
  type ControlLevel,
  type ControlMeasure,
  type Swms,
  type SwmsAction,
  type SwmsDetail,
  type SwmsStatus,
} from '../lib/types';

const STATUSES = Object.keys(STATUS_LABELS) as SwmsStatus[];
const TONE: Record<SwmsStatus, StatusTone> = {
  submitted: 'info',
  reviewed: 'warning',
  accepted: 'success',
  rejected: 'danger',
};

/** The SWMS register (high-risk work). `?id=` opens one SWMS with its checklist, history and review actions. */
export function SwmsScreen() {
  const [params, setParams] = useUrlState(['status', 'id'] as const);
  return params.id ? (
    <SwmsDetailView id={params.id} />
  ) : (
    <SwmsList status={params.status} setStatus={(v) => setParams({ status: v })} />
  );
}

function SwmsList({ status, setStatus }: { status: string; setStatus: (v: string) => void }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const valid = STATUSES.includes(status as SwmsStatus) ? (status as SwmsStatus) : undefined;
  const list = useSwmsList({ status: valid });
  const m = useSwmsMutations();
  const [adding, setAdding] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'swms', id: 'register' },
  });

  const columns: DataTableColumn<Swms>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (s) => s.numberLabel,
      cell: (s) => (
        <Link
          href={webRoutes.swms(org.orgSlug, project.projectId, s.id)}
          aria-label={`${s.numberLabel} ${s.title}`}
        >
          {s.numberLabel}
        </Link>
      ),
    },
    { id: 'title', header: 'Title', sortValue: (s) => s.title, cell: (s) => s.title },
    {
      id: 'company',
      header: 'Company',
      cell: (s) => (s.companyId ? dir.companyName(s.companyId) : '—'),
    },
    {
      id: 'categories',
      header: 'High-risk work',
      cell: (s) =>
        s.categories.length === 0
          ? '—'
          : s.categories.length === 1
            ? CATEGORY_LABELS[s.categories[0]!]
            : `${s.categories.length} categories`,
    },
    {
      id: 'expires',
      header: 'Expires',
      sortValue: (s) => s.expiresOn ?? '9999',
      cell: (s) =>
        s.expiresOn ? (
          s.isExpired ? (
            <StatusPill tone="danger">Expired · {formatLocalDate(s.expiresOn)}</StatusPill>
          ) : (
            formatLocalDate(s.expiresOn)
          )
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (s) => s.status,
      cell: (s) => (
        <StatusPill tone={TONE[s.status]}>
          {STATUS_LABELS[s.status]} · rev {s.revision}
        </StatusPill>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="SWMS"
        description="Safe work method statements for high-risk construction work. Review them before the work starts."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Submit SWMS
          </Button>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="SWMS" /> : null}
      <FilterBar label="Filter SWMS">
        <Select
          label="Status"
          value={status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setStatus(e.target.value)}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load SWMS" />
      {list.isPending ? (
        <SkeletonRows label="Loading SWMS…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={SwmsIcon}
          title={valid ? 'No SWMS match' : 'No SWMS yet'}
          description={
            valid ? 'Try a different status.' : 'Submit one before high-risk work begins.'
          }
        />
      ) : (
        <DataTable caption="SWMS" columns={columns} rows={list.data ?? []} getRowId={(s) => s.id} />
      )}
      {adding ? (
        <SubmitDialog
          dir={dir}
          pending={m.create.isPending}
          error={m.create.error}
          onClose={() => setAdding(false)}
          onSave={(input) => m.create.mutate(input, { onSuccess: () => setAdding(false) })}
        />
      ) : null}
    </>
  );
}

function SwmsDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = useSwmsDetail(id);
  const m = useSwmsMutations();
  const [acting, setActing] = useState<SwmsAction | null>(null);
  const [ackName, setAckName] = useState('');
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'swms', id } });
  const d = q.data;

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.swms(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> SWMS register
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading SWMS…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="SWMS" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this SWMS" />
      </>
    );
  }
  const s = d.swms;
  const ACTION_ICONS = { markReviewed: Eye, accept: Check, reject: X, reopen: RotateCcw } as const;
  return (
    <>
      <p className="u-m-0" style={{ marginBottom: 'var(--space-4)' }}>
        {back}
      </p>
      <ItemHeader
        number={`${s.numberLabel} · revision ${s.revision}`}
        title={s.title}
        status={<StatusPill tone={TONE[s.status]}>{STATUS_LABELS[s.status]}</StatusPill>}
        ballInCourt={s.companyId ? dir.companyName(s.companyId) : undefined}
        due={
          s.expiresOn
            ? `${s.isExpired ? 'Expired' : 'Expires'} ${formatLocalDate(s.expiresOn)}`
            : undefined
        }
        actions={d.availableActions.map((a) => {
          const Icon = ACTION_ICONS[a];
          return (
            <Button
              key={a}
              variant={a === 'reject' || a === 'markReviewed' ? 'secondary' : 'primary'}
              onClick={() => setActing(a)}
            >
              <Icon size={16} aria-hidden="true" /> {ACTION_LABELS[a]}
            </Button>
          );
        })}
      />
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Required content">
            <div className="stack">
              {d.gaps.length === 0 ? (
                <Alert tone="success">
                  Every required item is present. This is a checklist, not a statement that the SWMS
                  is compliant.
                </Alert>
              ) : (
                <Alert tone="warning" title="Missing before it can be accepted">
                  <ul>
                    {d.gaps.map((g) => (
                      <li key={`${g.item}-${g.field}`}>{g.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {d.advisories.map((a) => (
                <Alert key={a.code} tone="info">
                  {a.message}
                </Alert>
              ))}
            </div>
          </Card>
          <Card title="The work">
            <div className="stack">
              <p className="u-m-0 u-prewrap">
                {s.workDescription || <span className="u-muted">Not described.</span>}
              </p>
              <div>
                <h3 className="panel-heading">Hazards and risks</h3>
                <p className="u-m-0 u-prewrap">
                  {s.hazardsAndRisks || <span className="u-muted">Not described.</span>}
                </p>
              </div>
              <div>
                <h3 className="panel-heading">Control measures</h3>
                {s.controlMeasures.length ? (
                  <ul className="plain-list">
                    {s.controlMeasures.map((c, i) => (
                      <li key={`${c.level}-${i}`} className="plain-list__item">
                        <strong>{CONTROL_LEVEL_LABELS[c.level]}</strong>
                        <span>{c.description}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="u-muted u-m-0">None listed.</p>
                )}
              </div>
            </div>
          </Card>
        </div>
        <div className="stack-lg">
          {s.categories.length ? (
            <Card title="High-risk work">
              <div className="row-actions">
                {s.categories.map((c) => (
                  <Badge key={c}>{CATEGORY_LABELS[c]}</Badge>
                ))}
              </div>
            </Card>
          ) : null}
          <Card title="Acknowledgements">
            <div className="stack">
              {s.status === 'accepted' ? (
                <div className="u-row">
                  <TextField
                    label="Worker name"
                    value={ackName}
                    onChange={(e) => setAckName(e.target.value)}
                  />
                  <Button
                    disabled={!ackName.trim() || m.acknowledge.isPending}
                    onClick={() =>
                      m.acknowledge.mutate(
                        { detail: d, workerName: ackName.trim() },
                        { onSuccess: () => setAckName('') },
                      )
                    }
                  >
                    <Check size={16} aria-hidden="true" /> Record that they’ve read it
                  </Button>
                </div>
              ) : (
                <p className="u-muted u-m-0">Workers can acknowledge it once it is accepted.</p>
              )}
              <ErrorAlert error={m.acknowledge.error} title="We couldn't record that" />
              {d.acknowledgements.length === 0 ? (
                <p className="u-muted u-m-0">No one has acknowledged this revision yet.</p>
              ) : (
                <ul className="plain-list">
                  {d.acknowledgements.map((a, i) => (
                    <li key={`${a.workerName}-${i}`} className="plain-list__item">
                      {a.workerName}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card title="History">
            <ActivityTimeline
              entries={d.events.map((e) => ({
                id: e.id,
                actor: `Revision ${e.revision}`,
                action: `${e.action} → ${e.toStatus}`,
                at: formatInstant(e.at, project.timezone),
                atIso: e.at,
                detail: e.note || undefined,
              }))}
            />
          </Card>
        </div>
      </div>
      {acting ? (
        <ReviewDialog
          detail={d}
          action={acting}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setActing(null)}
          onConfirm={(reason, confirmed) =>
            m.transition.mutate(
              {
                detail: d,
                input: {
                  action: acting,
                  reason: reason || undefined,
                  confirmedUnderstandable: confirmed || undefined,
                },
              },
              { onSuccess: () => setActing(null) },
            )
          }
        />
      ) : null}
    </>
  );
}

function ReviewDialog({
  detail,
  action,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  detail: SwmsDetail;
  action: SwmsAction;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string, confirmed: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const mustGiveReason = needsReason(action);
  const blocked = action === 'accept' && (detail.gaps.length > 0 || !confirmed);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} ${detail.swms.numberLabel}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(mustGiveReason && !reason.trim()) || blocked || pending}
            onClick={() => onConfirm(reason.trim(), confirmed)}
          >
            {pending ? 'Saving…' : ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        {mustGiveReason ? (
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        ) : null}
        {action === 'accept' ? (
          <>
            {detail.gaps.length > 0 ? (
              <Alert tone="warning">
                Required content is still missing, so it can’t be accepted.
              </Alert>
            ) : null}
            <Checkbox
              label="I confirm this SWMS is set out so the people who use it can readily understand it."
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
          </>
        ) : null}
        <ErrorAlert error={error} title="We couldn't update the SWMS" />
      </div>
    </Dialog>
  );
}

function SubmitDialog({
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  dir: ReturnType<typeof useProjectDirectory>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: {
    title: string;
    companyId?: string;
    categories: Category[];
    workDescription?: string;
    hazardsAndRisks?: string;
    controlMeasures?: ControlMeasure[];
    implementation?: string;
    siteSpecific?: string;
    whsPlanConsidered?: string;
    fallControlsConsidered?: string;
    expiresOn?: string;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [work, setWork] = useState('');
  const [hazards, setHazards] = useState('');
  const [expires, setExpires] = useState('');
  const [controls, setControls] = useState<ControlMeasure[]>([]);
  const [level, setLevel] = useState<ControlLevel>('engineer');
  const [controlText, setControlText] = useState('');
  const [implementation, setImplementation] = useState('');
  const [siteSpecific, setSiteSpecific] = useState('');
  const [whsPlan, setWhsPlan] = useState('');
  const [fallControls, setFallControls] = useState('');
  const toggle = (c: Category) =>
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Submit SWMS"
      description="Fill in everything the reviewer needs: a SWMS can’t be accepted while required content is missing."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                companyId: company || undefined,
                categories,
                workDescription: work.trim() || undefined,
                hazardsAndRisks: hazards.trim() || undefined,
                controlMeasures: controls.length ? controls : undefined,
                implementation: implementation.trim() || undefined,
                siteSpecific: siteSpecific.trim() || undefined,
                whsPlanConsidered: whsPlan.trim() || undefined,
                fallControlsConsidered: fallControls.trim() || undefined,
                expiresOn: expires || undefined,
              })
            }
          >
            {pending ? 'Submitting…' : 'Submit SWMS'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          label="Company"
          value={company}
          placeholder="Not set"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <fieldset className="stack">
          <legend>High-risk work this covers</legend>
          {CATEGORIES.map((c) => (
            <Checkbox
              key={c}
              label={CATEGORY_LABELS[c]}
              checked={categories.includes(c)}
              onChange={() => toggle(c)}
            />
          ))}
        </fieldset>
        <Textarea
          label="Description of the work"
          value={work}
          onChange={(e) => setWork(e.target.value)}
        />
        <Textarea
          label="Hazards and risks"
          value={hazards}
          onChange={(e) => setHazards(e.target.value)}
        />
        <fieldset className="stack">
          <legend>Control measures</legend>
          {controls.length > 0 ? (
            <ul>
              {controls.map((c, i) => (
                <li key={`${c.level}-${i}`}>
                  {CONTROL_LEVEL_LABELS[c.level]}: {c.description}{' '}
                  <Button
                    variant="tertiary"
                    aria-label={`Remove control ${i + 1}`}
                    onClick={() => setControls((cur) => cur.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Select
            label="Type of control"
            value={level}
            options={CONTROL_LEVELS.map((v) => ({ value: v, label: CONTROL_LEVEL_LABELS[v] }))}
            onChange={(e) => setLevel(e.target.value as ControlLevel)}
          />
          <TextField
            label="Control measure"
            value={controlText}
            onChange={(e) => setControlText(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!controlText.trim()}
            onClick={() => {
              setControls((cur) => [...cur, { level, description: controlText.trim() }]);
              setControlText('');
            }}
          >
            Add control measure
          </Button>
        </fieldset>
        <Textarea
          label="How the controls will be implemented, monitored and reviewed"
          value={implementation}
          onChange={(e) => setImplementation(e.target.value)}
        />
        <Textarea
          label="Circumstances at this site"
          value={siteSpecific}
          onChange={(e) => setSiteSpecific(e.target.value)}
        />
        <Textarea
          label="WHS management plan considered"
          value={whsPlan}
          onChange={(e) => setWhsPlan(e.target.value)}
        />
        {categories.includes('fall_2m') ? (
          <Textarea
            label="Fall controls considered"
            value={fallControls}
            onChange={(e) => setFallControls(e.target.value)}
          />
        ) : null}
        <TextField
          label="Expires on"
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't submit the SWMS" />
      </div>
    </Dialog>
  );
}
