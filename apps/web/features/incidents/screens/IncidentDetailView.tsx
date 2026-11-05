'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import { Alert, Button, PageHeader, SkeletonRows, StatusPill, buttonClassName } from '@archova/ui';
import { ChevronLeft } from '@archova/ui/icons';
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

  return (
    <>
      <PageHeader
        eyebrow={`${i.numberLabel} · ${TYPE_LABELS[i.type]}`}
        title={i.title}
        description={`${formatInstant(i.occurredAt, tz)}${i.location ? ` · ${i.location}` : ''}`}
        actions={
          <>
            {back}
            {d.canManage ? (
              <>
                {i.status !== 'closed' ? (
                  <Button variant="secondary" onClick={() => setDialog('classify')}>
                    Classify
                  </Button>
                ) : null}
                {next ? (
                  <Button onClick={() => setDialog(next)}>{ACTION_LABELS[next]}</Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      <p>
        <StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABELS[i.status]}</StatusPill>{' '}
        <StatusPill tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABELS[i.severity]}</StatusPill>
      </p>

      {i.isNotifiable ? (
        <section aria-labelledby="inc-notifiable" className="stack">
          <h2 id="inc-notifiable">Notifiable incident</h2>
          <Alert tone="danger" title={i.notifiableClass ? CLASS_LABELS[i.notifiableClass] : ''}>
            Tell your state work health and safety regulator immediately, by the fastest means.
            Archova does not notify the regulator for you. Do not disturb the site except to help
            injured people or make it safe.
          </Alert>
          <p>
            {i.regulatorNotifiedAt
              ? `Regulator notified ${formatInstant(i.regulatorNotifiedAt, tz)}.`
              : 'The time the regulator was notified has not been recorded.'}
          </p>
          {i.writtenNoticeDueAt ? (
            <Alert tone="warning">
              Written notice is due by {formatInstant(i.writtenNoticeDueAt, tz)} (48 hours after the
              regulator asked for it).
            </Alert>
          ) : null}
          {i.keepUntil ? (
            <p className="u-muted">
              Kept until at least {formatLocalDate(i.keepUntil.slice(0, 10))}.
            </p>
          ) : null}
        </section>
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

      <section aria-labelledby="inc-what" className="stack">
        <h2 id="inc-what">What happened</h2>
        <p>{i.description || <span className="u-muted">Not described.</span>}</p>
        <h3>Done straight away</h3>
        <p>{i.immediateActions || <span className="u-muted">Nothing recorded.</span>}</p>
      </section>

      <section aria-labelledby="inc-people" className="stack">
        <h2 id="inc-people">People involved</h2>
        {d.people.length === 0 ? (
          <p className="u-muted">No one recorded.</p>
        ) : (
          <ul>
            {d.people.map((p) => (
              <li key={p.id}>
                {p.personName} · {ROLE_LABELS[p.role]}
                {p.companyId ? ` · ${dir.companyName(p.companyId)}` : ''}
              </li>
            ))}
          </ul>
        )}
        {d.injuryHidden ? (
          <p className="u-muted">
            Injury details are only shown to people who may see health information.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="inc-cause" className="stack">
        <h2 id="inc-cause">Root cause</h2>
        {i.rootCause ? (
          <>
            <p>{i.rootCause.summary}</p>
            <ul>
              {i.rootCause.causes.map((c, n) => (
                <li key={`${c}-${n}`}>{c}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="u-muted">Not recorded yet.</p>
        )}
      </section>

      <section aria-labelledby="inc-actions" className="stack">
        <h2 id="inc-actions">Corrective actions</h2>
        {d.canManage && i.status !== 'closed' ? (
          <div>
            <Button variant="secondary" onClick={() => setDialog('action')}>
              Add corrective action
            </Button>
          </div>
        ) : null}
        <ErrorAlert error={m.setActionStatus.error} title="We couldn't update the action" />
        {d.actions.length === 0 ? (
          <p className="u-muted">No corrective actions yet.</p>
        ) : (
          <ul className="stack">
            {d.actions.map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong>{' '}
                <StatusPill tone={CORRECTIVE_TONE[a.status]}>
                  {CORRECTIVE_LABELS[a.status]}
                </StatusPill>
                {a.isOverdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
                <div className="u-caption">
                  {a.assigneeCompanyId ? dir.companyName(a.assigneeCompanyId) : 'Not assigned'}
                  {a.dueDate ? ` · due ${formatLocalDate(a.dueDate)}` : ''}
                </div>
                {a.description ? <p>{a.description}</p> : null}
                {i.status !== 'closed' ? (
                  <div className="u-row">
                    {a.status === 'open' ? (
                      <Button
                        variant="secondary"
                        aria-label={`Mark ${a.title} done`}
                        onClick={() => setAction(a.id, 'done')}
                      >
                        Mark done
                      </Button>
                    ) : null}
                    {a.status === 'done' && d.canManage ? (
                      <>
                        <Button
                          aria-label={`Verify ${a.title}`}
                          onClick={() => setAction(a.id, 'verified')}
                        >
                          Verify
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Send ${a.title} back`}
                          onClick={() => setAction(a.id, 'open')}
                        >
                          Send back
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inc-history" className="stack">
        <h2 id="inc-history">History</h2>
        <ul>
          {d.events.map((e) => (
            <li key={e.id}>
              {formatInstant(e.at, tz)}: {e.action.replaceAll('_', ' ')} → {e.toStatus}
              {e.note ? ` (${e.note})` : ''}
            </li>
          ))}
        </ul>
      </section>

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
