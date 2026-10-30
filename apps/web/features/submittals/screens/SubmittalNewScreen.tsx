'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, PageHeader, Select, TextField } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { dueInBusinessDays, formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useSubmittalMutations } from '../hooks/useSubmittals';
import {
  SUBMITTAL_TYPES,
  TYPE_LABELS,
  type SubmittalInput,
  type SubmittalType,
} from '../lib/types';

const EMPTY: SubmittalInput = {
  title: '',
  numberLabel: '',
  type: 'shop_drawing',
  specSection: '',
  responsibleCompanyId: '',
  requiredOnSite: '',
  leadTimeDays: 0,
  reviewDays: 10,
};

/** Adds an item to the register (SUB-AC1). The submit-by date shows as the dates are filled in (SUB-AC2). */
export function SubmittalNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'submittals', id: 'new' },
  });
  const { create } = useSubmittalMutations(project.projectId);
  const [v, setV] = useState<SubmittalInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SubmittalInput>(k: K, value: SubmittalInput[K]) =>
    setV((x) => ({ ...x, [k]: value }));
  const submitBy = v.requiredOnSite
    ? dueInBusinessDays(v.requiredOnSite, -(v.leadTimeDays + v.reviewDays))
    : null;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) {
      setError('Give the item a title.');
      return;
    }
    setError(null);
    create.mutate(v, {
      onSuccess: (d) =>
        router.push(webRoutes.submittal(org.orgSlug, project.projectId, d.submittal.id)),
    });
  };
  const days = (key: 'leadTimeDays' | 'reviewDays') => (e: { target: { value: string } }) =>
    set(key, e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value))));

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.submittals(org.orgSlug, project.projectId)}>
            Submittals
          </Link>
        }
        title="Add submittal"
        description="Set up what has to be approved and when it's needed on site. You send it for review from the item."
      />
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <TextField
            label="Title"
            required
            value={v.title}
            error={error ?? undefined}
            onChange={(e) => set('title', e.target.value)}
          />
          <TextField
            label="Number (optional)"
            placeholder="SD-014 or 0331-1"
            hint="Leave blank to number it automatically."
            value={v.numberLabel}
            onChange={(e) => set('numberLabel', e.target.value)}
          />
          <Select
            label="Type"
            value={v.type}
            options={SUBMITTAL_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            onChange={(e) => set('type', e.target.value as SubmittalType)}
          />
          <TextField
            label="Spec section"
            placeholder="0331 Concrete – combined"
            value={v.specSection}
            onChange={(e) => set('specSection', e.target.value)}
          />
          <Select
            label="Responsible company"
            value={v.responsibleCompanyId}
            placeholder="Not set"
            options={dir.companies
              .filter((c) => !c.isBuilder)
              .map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => set('responsibleCompanyId', e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField
            label="Required on site"
            type="date"
            value={v.requiredOnSite}
            onChange={(e) => set('requiredOnSite', e.target.value)}
          />
          <TextField
            label="Lead time (business days)"
            type="number"
            min={0}
            inputMode="numeric"
            value={v.leadTimeDays}
            hint="Fabrication or delivery time after approval."
            onChange={days('leadTimeDays')}
          />
          <TextField
            label="Review time (business days)"
            type="number"
            min={0}
            inputMode="numeric"
            value={v.reviewDays}
            hint="Time to allow for the whole review."
            onChange={days('reviewDays')}
          />
        </div>
        <p className="u-m-0" aria-live="polite">
          {submitBy ? (
            <>
              Submit by <strong>{formatLocalDate(submitBy)}</strong> to be on site in time.
            </>
          ) : (
            <span className="u-muted">
              Enter a required-on-site date to see the submit-by date.
            </span>
          )}
        </p>
        <ErrorAlert error={create.error} title="We couldn't add this item" />
        <div className="row-actions">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add to register'}
          </Button>
          <Link className="link" href={webRoutes.submittals(org.orgSlug, project.projectId)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
