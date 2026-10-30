'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, PageHeader, Select, SkeletonRows, TextField } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useCorrespondenceMutations, useProjectTypes } from '../hooks/useCorrespondence';

/** Starts a draft from a type; the subject and body come from the type's template and are edited on the item. */
export function CorrespondenceNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'correspondence', id: 'new' },
  });
  const types = useProjectTypes(project.projectId);
  const { create } = useCorrespondenceMutations(project.projectId);
  const [typeId, setTypeId] = useState('');
  const [to, setTo] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const type = types.data?.find((t) => t.id === typeId);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!typeId) {
      setError('Choose what you are writing.');
      return;
    }
    setError(null);
    create.mutate(
      { typeId, subject: '', body: '', toCompanyIds: to ? [to] : [], eventDate },
      {
        onSuccess: (d) =>
          router.push(webRoutes.correspondenceItem(org.orgSlug, project.projectId, d.item.id)),
      },
    );
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.correspondence(org.orgSlug, project.projectId)}>
            Correspondence
          </Link>
        }
        title="New correspondence"
        description="Pick the type and who it goes to. You write and send it from the draft."
      />
      {types.isPending ? (
        <SkeletonRows label="Loading types…" />
      ) : (
        <form className="stack-lg" onSubmit={save} noValidate>
          <div className="form-row">
            <Select
              label="Type"
              required
              value={typeId}
              placeholder="Choose a type"
              error={error ?? undefined}
              options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
              onChange={(e) => setTypeId(e.target.value)}
            />
            <Select
              label="To"
              value={to}
              placeholder="Choose a company"
              options={dir.companies.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(e) => setTo(e.target.value)}
            />
            {type?.timeBarDays ? (
              <TextField
                label="Date of the event"
                type="date"
                value={eventDate}
                hint={`Starts the ${type.timeBarDays}-day notice period. Confirm the period in your contract.`}
                onChange={(e) => setEventDate(e.target.value)}
              />
            ) : null}
          </div>
          {type?.timeBarDays && eventDate ? (
            <p className="u-m-0" aria-live="polite">
              Give notice within {type.timeBarDays} days of{' '}
              <strong>{formatLocalDate(eventDate)}</strong>.
            </p>
          ) : null}
          <ErrorAlert error={create.error} title="We couldn't start this draft" />
          <div className="row-actions">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Starting…' : 'Start draft'}
            </Button>
            <Link className="link" href={webRoutes.correspondence(org.orgSlug, project.projectId)}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
