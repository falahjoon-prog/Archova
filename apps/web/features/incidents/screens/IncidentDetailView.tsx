'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  ActivityTimeline,
  Alert,
  Button,
  Card,
  DescriptionList,
  ItemHeader,
  PageHeader,
  SkeletonRows,
  StatusPill,
  buttonClassName,
} from '@archova/ui';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Undo2,
} from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useIncidentDetail, useIncidentMutations } from '../hooks/useIncidents';
import {
  ACTION_LABELS,
  CLASS_LABELS,
  CORRECTIVE_LABELS,
  ROLE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  type CorrectiveStatus,
  type IncidentAction,
} from '../lib/types';
import { ActionDialog, ClassifyDialog, TransitionDialog } from './dialogs';
import { CORRECTIVE_TONE, SEVERITY_TONE, STATUS_TONE } from './tones';

const NEXT: Record<string, IncidentAction | undefined> = {
  reported: 'investigate',
  investigating: 'close',
  closed: 'reopen',
};

export function IncidentDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = useIncidentDetail(id);
  const m = useIncidentMutations();
  const [dialog, setDialog] = useState<'classify' | 'action' | IncidentAction | null>(null);
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'incident', id } });
  const d = q.data;
  const tz = project.timezone;

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.incidents(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Incidents
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading incident…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="Incident" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this incident" />
      </>
    );
  }
  const i = d.incident;
  const next = NEXT[i.status];
  const setAction = (actionId: string, status: CorrectiveStatus) =>
    m.setActionStatus.mutate({ detail: d, actionId, status });

  const ACTION_ICONS = { investigate: Search, close: CheckCircle2, reopen: RotateCcw } as const;
  const NextIcon = next ? ACTION_ICONS[next] : null;

  return (
    <>
      <p className="u-m-0" style={{ marginBottom: 'var(--space-4)' }}>
        {back}
      </p>
      <ItemHeader
        number={`${i.numberLabel} · ${TYPE_LABELS[i.type]}`}
        title={i.title}
        status={<StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABELS[i.status]}</StatusPill>}
        meta={
          <StatusPill tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABELS[i.severity]}</StatusPill>
        }
        actions={
          d.canManage ? (
            <>
              {i.status !== 'closed' ? (
                <Button variant="secondary" onClick={() => setDialog('classify')}>
                  <Tag size={16} aria-hidden="true" /> Classify
                </Button>
              ) : null}
              {next && NextIcon ? (
                <Button onClick={() => setDialog(next)}>
                  <NextIcon size={16} aria-hidden="true" /> {ACTION_LABELS[next]}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {i.isNotifiable ? (
        <Card title="Notifiable incident">
          <div className="stack">
            <Alert tone="danger" title={i.notifiableClass ? CLASS_LABELS[i.notifiableClass] : ''}>
              Tell your state work health and safety regulator immediately, by the fastest means.
              Archova does not notify the regulator for you. Do not disturb the site except to help
              injured people or make it safe.
            </Alert>
            <p className="u-m-0">
              {i.regulatorNotifiedAt
                ? `Regulator notified ${formatInstant(i.regulatorNotifiedAt, tz)}.`
                : 'The time the regulator was notified has not been recorded.'}
            </p>
            {i.writtenNoticeDueAt ? (
              <Alert tone="warning">
                Written notice is due by {formatInstant(i.writtenNoticeDueAt, tz)} (48 hours after
                the regulator asked for it).
              </Alert>
            ) : null}
            {i.keepUntil ? (
              <p className="u-muted u-m-0">
                Kept until at least {formatLocalDate(i.keepUntil.slice(0, 10))}.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {i.status === 'investigating' && d.closeBlockers.length > 0 ? (
        <Alert tone="warning" title="Before this can close">
          <ul>
            {d.closeBlockers.map((b) => (
              <li key={b.field}>{b.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="What happened">
            <div className="stack">
              <p className="u-m-0 u-prewrap">
                {i.description || <span className="u-muted">Not described.</span>}
              </p>
              <div>
                <h3 className="panel-heading">Done straight away</h3>
                <p className="u-m-0 u-prewrap">
                  {i.immediateActions || <span className="u-muted">Nothing recorded.</span>}
                </p>
              </div>
            </div>
          </Card>

          <Card title="Root cause">
            {i.rootCause ? (
              <div className="stack">
                <p className="u-m-0">{i.rootCause.summary}</p>
                <ul className="u-m-0">
                  {i.rootCause.causes.map((c, n) => (
                    <li key={`${c}-${n}`}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="u-muted u-m-0">Not recorded yet.</p>
            )}
          </Card>

          <Card
            title="Corrective actions"
            actions={
              d.canManage && i.status !== 'closed' ? (
                <Button variant="secondary" onClick={() => setDialog('action')}>
                  <Plus size={16} aria-hidden="true" /> Add corrective action
                </Button>
              ) : null
            }
          >
            <ErrorAlert error={m.setActionStatus.error} title="We couldn't update the action" />
            {d.actions.length === 0 ? (
              <p className="u-muted u-m-0">No corrective actions yet.</p>
            ) : (
              <ul className="plain-list">
                {d.actions.map((a) => (
                  <li key={a.id} className="plain-list__item">
                    <div className="row-actions">
                      <strong>{a.title}</strong>
                      <StatusPill tone={CORRECTIVE_TONE[a.status]}>
                        {CORRECTIVE_LABELS[a.status]}
                      </StatusPill>
                      {a.isOverdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
                    </div>
                    <div className="u-caption">
                      {a.assigneeCompanyId ? dir.companyName(a.assigneeCompanyId) : 'Not assigned'}
                      {a.dueDate ? ` · due ${formatLocalDate(a.dueDate)}` : ''}
                      {a.source?.type === 'inspection' ? (
                        <>
                          {' · '}
                          <Link
                            className="link"
                            href={webRoutes.inspections(
                              org.orgSlug,
                              project.projectId,
                              a.source.id,
                            )}
                          >
                            From an inspection
                          </Link>
                        </>
                      ) : a.source ? (
                        ' · From an observation'
                      ) : null}
                    </div>
                    {a.description ? <p className="u-m-0">{a.description}</p> : null}
                    {i.status !== 'closed' ? (
                      <div className="row-actions">
                        {a.status === 'open' ? (
                          <Button
                            variant="secondary"
                            aria-label={`Mark ${a.title} done`}
                            onClick={() => setAction(a.id, 'done')}
                          >
                            <Check size={16} aria-hidden="true" /> Mark done
                          </Button>
                        ) : null}
                        {a.status === 'done' && d.canManage ? (
                          <>
                            <Button
                              aria-label={`Verify ${a.title}`}
                              onClick={() => setAction(a.id, 'verified')}
                            >
                              <CheckCircle2 size={16} aria-hidden="true" /> Verify
                            </Button>
                            <Button
                              variant="secondary"
                              aria-label={`Send ${a.title} back`}
                              onClick={() => setAction(a.id, 'open')}
                            >
                              <Undo2 size={16} aria-hidden="true" /> Send back
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="stack-lg">
          <Card title="Details">
            <DescriptionList
              items={[
                { label: 'Type', value: TYPE_LABELS[i.type] },
                { label: 'When', value: formatInstant(i.occurredAt, tz) },
                { label: 'Where', value: i.location || '—' },
                ...(i.notifiableClass
                  ? [{ label: 'Class', value: CLASS_LABELS[i.notifiableClass] }]
                  : []),
              ]}
            />
          </Card>

          <Card title="People involved">
            {d.people.length === 0 ? (
              <p className="u-muted u-m-0">No one recorded.</p>
            ) : (
              <ul className="plain-list">
                {d.people.map((p) => (
                  <li key={p.id} className="plain-list__item">
                    <strong>{p.personName}</strong>
                    <span className="u-caption">
                      {ROLE_LABELS[p.role]}
                      {p.companyId ? ` · ${dir.companyName(p.companyId)}` : ''}
                      {p.injury
                        ? ` · ${Object.values(p.injury)
                            .filter((v) => typeof v === 'string' && v)
                            .join(' · ')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.photoFileIds.length > 0 ? (
              <p className="u-caption">
                <Camera size={14} aria-hidden="true" /> {d.photoFileIds.length}{' '}
                {d.photoFileIds.length === 1 ? 'photo' : 'photos'} taken at the scene on a phone.
              </p>
            ) : null}
            {d.injuryHidden ? (
              <p className="u-muted">
                Injury details are only shown to people who may see health information.
              </p>
            ) : null}
          </Card>

          <Card title="History">
            <ActivityTimeline
              entries={d.events.map((e) => ({
                id: e.id,
                actor: e.action.replaceAll('_', ' '),
                action: `→ ${e.toStatus}`,
                at: formatInstant(e.at, tz),
                atIso: e.at,
                detail: e.note || undefined,
              }))}
            />
          </Card>
        </div>
      </div>

      {dialog === 'classify' ? (
        <ClassifyDialog
          detail={d}
          timeZone={tz}
          pending={m.classify.isPending}
          error={m.classify.error}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            m.classify.mutate({ detail: d, input }, { onSuccess: () => setDialog(null) })
          }
        />
      ) : null}
      {dialog === 'action' ? (
        <ActionDialog
          dir={dir}
          pending={m.addAction.isPending}
          error={m.addAction.error}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            m.addAction.mutate({ detail: d, input }, { onSuccess: () => setDialog(null) })
          }
        />
      ) : null}
      {dialog === 'investigate' || dialog === 'close' || dialog === 'reopen' ? (
        <TransitionDialog
          detail={d}
          action={dialog}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            m.transition.mutate(
              { detail: d, input: { action: dialog, reason: reason || undefined } },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
    </>
  );
}
