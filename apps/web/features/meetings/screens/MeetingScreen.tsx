'use client';

import Link from 'next/link';
import { RecordRecent } from '@/features/recents';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { AddSectionForm } from '../components/AddSectionForm';
import { AttendanceCard } from '../components/AttendanceCard';
import { IssueDialog } from '../components/IssueDialog';
import { NovaMinutesDialog } from '../components/NovaMinutesDialog';
import { SectionCard } from '../components/SectionCard';
import { useMeeting, useMeetingMutations } from '../hooks/useMeetings';
import { saveFile } from '../lib/labels';

/** One meeting's minutes: attendance, numbered items by section, and the issued versions. */
export function MeetingScreen({ meetingId }: { meetingId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'meeting', id: meetingId },
  });
  const meeting = useMeeting(meetingId);
  const { pdf, update } = useMeetingMutations(meetingId);
  const [issuing, setIssuing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [pickedVersion, setPickedVersion] = useState('');

  if (meeting.isPending) return <SkeletonRows label="Loading the minutes…" />;
  if (meeting.error || !meeting.data)
    return <ErrorAlert error={meeting.error} title="We couldn't load the minutes" />;
  const d = meeting.data;
  const m = d.meeting;
  const latest = d.versions.at(-1)?.version ?? null;
  const version = pickedVersion ? Number(pickedVersion) : latest;

  return (
    <div className="stack-lg">
      <RecordRecent
        entityType="meeting"
        entityId={m.id}
        projectId={project.projectId}
        title={m.title}
        subtitle={`${m.seriesName}, meeting ${m.number}`}
      />
      <p className="breadcrumb">
        <Link className="link" href={webRoutes.meetings(org.orgSlug, project.projectId)}>
          Meetings
        </Link>
      </p>
      <PageHeader
        title={m.title}
        eyebrow={`${m.seriesName}, meeting ${m.number}`}
        description={`${formatInstant(m.heldAt, project.timezone)}${m.location ? `, ${m.location}` : ''}`}
        actions={
          <>
            {d.viewer.canEdit ? (
              <Button variant="secondary" onClick={() => setDrafting(true)}>
                Draft with Nova
              </Button>
            ) : null}
            {d.viewer.canIssue ? (
              <Button onClick={() => setIssuing(true)}>
                {m.issuedVersion === 0 ? 'Issue minutes' : 'Issue a correction'}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="details-row">
        {m.status === 'issued' ? (
          <StatusPill tone="success">Issued version {m.issuedVersion}</StatusPill>
        ) : (
          <StatusPill tone="neutral">Draft, not issued</StatusPill>
        )}
        {m.correctionsBy ? (
          <span className="u-caption">Corrections by {formatLocalDate(m.correctionsBy)}</span>
        ) : null}
      </div>

      {d.viewer.audience === 'external' ? (
        <Alert tone="info" title={`You are reading issued version ${d.viewer.viewingVersion}`}>
          <p className="u-m-0">Sections for the builder only are not shown.</p>
        </Alert>
      ) : null}

      <ErrorAlert error={update.error} title="We couldn't save the meeting" />

      <div className="detail-grid">
        <div className="stack-lg">
          {d.sections.map((s) => (
            <SectionCard key={s.id} section={s} meetingId={m.id} canEdit={d.viewer.canEdit} />
          ))}
          {d.viewer.canEdit ? <AddSectionForm meetingId={m.id} /> : null}
        </div>
        <div className="stack-lg">
          {d.viewer.canEdit ? (
            <Card title="Meeting details">
              <form
                className="stack"
                aria-label="Meeting details"
                onSubmit={(e) => e.preventDefault()}
              >
                <TextField
                  key={`t-${m.version}`}
                  label="Title"
                  defaultValue={m.title}
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title && title !== m.title)
                      update.mutate({ version: m.version, body: { title } });
                  }}
                />
                <TextField
                  key={`l-${m.version}`}
                  label="Where"
                  defaultValue={m.location}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== m.location)
                      update.mutate({
                        version: m.version,
                        body: { location: e.target.value.trim() },
                      });
                  }}
                />
                <TextField
                  key={`c-${m.version}`}
                  label="Corrections by"
                  type="date"
                  defaultValue={m.correctionsBy ?? ''}
                  onBlur={(e) => {
                    if ((e.target.value || null) !== m.correctionsBy)
                      update.mutate({
                        version: m.version,
                        body: { correctionsBy: e.target.value || null },
                      });
                  }}
                />
              </form>
            </Card>
          ) : null}
          {latest ? (
            <Card title="Issued versions">
              <div className="stack">
                <ul className="minutes-versions">
                  {d.versions.map((v) => (
                    <li key={v.version}>
                      Version {v.version}, {formatInstant(v.issuedAt, project.timezone)}
                      {d.viewer.audience === 'internal' ? `, sent to ${v.recipients.length}` : ''}
                      {v.note ? ` — ${v.note}` : ''}
                    </li>
                  ))}
                </ul>
                <div className="form-row">
                  <Select
                    label="Version"
                    options={d.versions.map((v) => ({
                      value: String(v.version),
                      label: `Version ${v.version}`,
                    }))}
                    value={String(version)}
                    onChange={(e) => setPickedVersion(e.target.value)}
                  />
                  <div>
                    <Button
                      variant="secondary"
                      loading={pdf.isPending}
                      onClick={() => version && pdf.mutate(version, { onSuccess: saveFile })}
                    >
                      Download PDF
                    </Button>
                  </div>
                </div>
                <ErrorAlert error={pdf.error} title="We couldn't make the PDF" />
              </div>
            </Card>
          ) : null}

          <AttendanceCard meetingId={m.id} attendees={d.attendees} canEdit={d.viewer.canEdit} />
        </div>
      </div>
      {d.viewer.canEdit ? (
        <NovaMinutesDialog open={drafting} onClose={() => setDrafting(false)} detail={d} />
      ) : null}
      {d.viewer.canIssue ? (
        <IssueDialog
          key={m.issuedVersion}
          open={issuing}
          onClose={() => setIssuing(false)}
          detail={d}
        />
      ) : null}
    </div>
  );
}
