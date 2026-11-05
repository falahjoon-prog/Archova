'use client';

import Link from 'next/link';
import { useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Textarea,
  buttonClassName,
  type StatusTone,
} from '@archova/ui';
import { AttendanceIcon, ChevronLeft } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useRollCallMutations, useRollCalls } from '../hooks/useAttendance';
import {
  MARK_LABELS,
  groupByCompany,
  progressLabel,
  type RollCall,
  type RollCallPerson,
  type RollMark,
} from '../lib/types';

const TONES: Record<RollMark, StatusTone> = {
  unmarked: 'warning',
  accounted_for: 'success',
  missing: 'danger',
  not_on_site: 'neutral',
};

type Mark = Exclude<RollMark, 'unmarked'>;
const MARKS: Mark[] = ['accounted_for', 'missing', 'not_on_site'];

/** Evacuation roll call (ATT-AC5): start from who is on site, tick people off, keep the record. */
export function RollCallScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const permissions = useProjectPermissions(org.orgId, project.projectId);
  // UI gating only; the API enforces `workforce.attendance.manage` for starting and ending (tool level admin).
  const canManage =
    previewDataOnly ||
    (permissions.data
      ? permissions.data.orgRole === 'owner' ||
        permissions.data.orgRole === 'admin' ||
        atLeast(permissions.data.toolLevels.workforce, 'admin')
      : false);
  const calls = useRollCalls();
  const m = useRollCallMutations();
  const [params, setParams] = useUrlState(['id'] as const);
  const [starting, setStarting] = useState(false);
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'attendance', id: 'roll-call' },
  });

  const all = calls.data ?? [];
  const open = all.find((r) => !r.endedAt) ?? null;
  const viewing = (params.id ? all.find((r) => r.id === params.id) : null) ?? open;
  const past = all.filter((r) => r.endedAt && r.id !== viewing?.id);

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Roll call"
        description="For an evacuation: start from who is on site, then tick each person as they are found."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendance(org.orgSlug, project.projectId)}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Attendance
            </Link>
            {canManage && !open ? (
              <Button onClick={() => setStarting(true)}>Start roll call</Button>
            ) : null}
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Roll call" /> : null}
      <ErrorAlert
        error={calls.error ?? m.mark.error}
        title="Something went wrong with the roll call"
      />
      {calls.isPending ? (
        <SkeletonRows label="Loading roll calls…" />
      ) : viewing ? (
        <RollCallCard
          rollCall={viewing}
          timeZone={project.timezone}
          companyName={dir.companyName}
          pending={m.mark.isPending}
          onMark={(person, status) =>
            m.mark.mutate({ rollCallId: viewing.id, workerId: person.workerId, status })
          }
          onEnd={canManage && !viewing.endedAt ? () => setEnding(true) : undefined}
        />
      ) : (
        <EmptyState
          icon={AttendanceIcon}
          title="No roll call in progress"
          description={
            canManage
              ? 'Start one in an emergency. It lists everyone signed in right now.'
              : 'A site manager starts a roll call in an emergency.'
          }
        />
      )}
      {past.length > 0 ? (
        <Card title="Earlier roll calls">
          <ul className="stack u-m-0" style={{ padding: 0, listStyle: 'none' }}>
            {past.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setParams({ id: r.id })}
                >
                  {formatInstant(r.startedAt, project.timezone)} · {r.reason}
                </button>{' '}
                <span className="u-caption">{progressLabel(r.counts)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog
        open={starting}
        onClose={() => setStarting(false)}
        title="Start roll call"
        description="This lists everyone signed in right now. Marks are kept as the record of the event."
        footer={
          <>
            <Button variant="secondary" onClick={() => setStarting(false)}>
              Cancel
            </Button>
            <Button
              disabled={!reason.trim() || m.start.isPending}
              onClick={() =>
                m.start.mutate(
                  { reason: reason.trim() },
                  {
                    onSuccess: (rc) => {
                      setStarting(false);
                      setReason('');
                      setParams({ id: rc.id });
                    },
                  },
                )
              }
            >
              {m.start.isPending ? 'Starting…' : 'Start roll call'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Textarea
            label="Reason"
            value={reason}
            placeholder="Fire alarm, evacuation drill…"
            onChange={(e) => setReason(e.target.value)}
          />
          <ErrorAlert error={m.start.error} title="We couldn't start the roll call" />
        </div>
      </Dialog>
      <Dialog
        open={ending && viewing !== null}
        onClose={() => setEnding(false)}
        title="End roll call"
        description={
          viewing && viewing.counts.unmarked + viewing.counts.missing > 0
            ? `${viewing.counts.unmarked + viewing.counts.missing} people are not yet accounted for. Ending closes the roll call; the record stays.`
            : 'Everyone is accounted for. Ending closes the roll call; the record stays.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnding(false)}>
              Cancel
            </Button>
            <Button
              disabled={m.end.isPending}
              onClick={() =>
                viewing &&
                m.end.mutate(viewing.id, {
                  onSuccess: (rc) => {
                    setEnding(false);
                    // Keep showing the record of the roll call that just ended.
                    setParams({ id: rc.id });
                  },
                })
              }
            >
              {m.end.isPending ? 'Ending…' : 'End roll call'}
            </Button>
          </>
        }
      >
        <ErrorAlert error={m.end.error} title="We couldn't end the roll call" />
      </Dialog>
    </>
  );
}

function RollCallCard({
  rollCall,
  timeZone,
  companyName,
  pending,
  onMark,
  onEnd,
}: {
  rollCall: RollCall;
  timeZone: string;
  companyName: (id: string) => string;
  pending: boolean;
  onMark: (person: RollCallPerson, status: Mark) => void;
  onEnd?: () => void;
}) {
  const ended = rollCall.endedAt !== null;
  const groups = groupByCompany(rollCall.people, companyName);
  return (
    <Card
      title={rollCall.reason}
      actions={onEnd ? <Button onClick={onEnd}>End roll call</Button> : undefined}
    >
      <p className="u-m-0">
        <strong>{progressLabel(rollCall.counts)}</strong>
        <br />
        <span className="u-caption">
          Started {formatInstant(rollCall.startedAt, timeZone)}
          {ended ? ` · Ended ${formatInstant(rollCall.endedAt!, timeZone)}` : ''}
        </span>
      </p>
      {ended ? (
        <Alert tone="info" title="This roll call has ended">
          The marks below are the record of the event.
        </Alert>
      ) : null}
      {groups.map((g) => (
        <section key={g.company} className="stack" aria-label={g.company}>
          <h3 className="u-m-0">{g.company}</h3>
          <ul className="stack u-m-0" style={{ padding: 0, listStyle: 'none' }}>
            {g.people.map((p) => (
              <li
                key={p.workerId}
                className="row-actions"
                style={{ justifyContent: 'space-between' }}
              >
                <span>
                  <strong>{p.fullName}</strong>
                  {p.phone ? (
                    <>
                      {' · '}
                      <a className="link" href={`tel:${p.phone.replace(/\s+/g, '')}`}>
                        {p.phone}
                      </a>
                    </>
                  ) : null}
                  <br />
                  <StatusPill tone={TONES[p.status]}>{MARK_LABELS[p.status]}</StatusPill>
                </span>
                {ended ? null : (
                  <span className="row-actions" role="group" aria-label={`Mark ${p.fullName}`}>
                    {MARKS.map((status) => (
                      <Button
                        key={status}
                        variant={p.status === status ? 'primary' : 'secondary'}
                        aria-pressed={p.status === status}
                        disabled={pending}
                        onClick={() => onMark(p, status)}
                      >
                        {MARK_LABELS[status]}
                      </Button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}
