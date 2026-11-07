'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { serverFieldErrors } from '@/shared/lib/forms';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { FieldInput } from '../components/FieldInput';
import type { FormDetail } from '../data/api';
import { useForm, useSaveForm, useSignForm, useSubmitForm } from '../hooks/useForms';
import { LINK_LABELS } from '../lib/fields';

const LINK_ROUTE = {
  diary: webRoutes.diary,
  incidents: webRoutes.incidents,
  inspections: webRoutes.inspections,
  attendance: webRoutes.attendance,
} as const;

/** Fill in, sign and submit one form. A submitted form is read-only. */
export function FormDetailScreen({ formId }: { formId: string }) {
  const project = useCurrentProject();
  const { orgSlug } = useCurrentOrg();
  usePublishAssistantScope({ projectId: project.projectId });
  const query = useForm(project.projectId, formId);

  return (
    <>
      <ErrorAlert error={query.error} title="We couldn't open this form" />
      {query.isPending ? <SkeletonRows rows={5} label="Loading form…" /> : null}
      {query.data ? (
        <FormBody
          key={query.data.form.id}
          detail={query.data}
          projectId={project.projectId}
          orgSlug={orgSlug}
          timeZone={project.timezone}
        />
      ) : null}
      {!query.isPending && !query.data && !query.error ? (
        <EmptyState title="Form not found" description="It may have been removed." />
      ) : null}
    </>
  );
}

function FormBody({
  detail,
  projectId,
  orgSlug,
  timeZone,
}: {
  detail: FormDetail;
  projectId: string;
  orgSlug: string;
  timeZone: string;
}) {
  const formId = detail.form.id;
  const save = useSaveForm(projectId, formId);
  const sign = useSignForm(projectId, formId);
  const submit = useSubmitForm(projectId, formId);
  const [answers, setAnswers] = useState<Record<string, unknown>>(detail.answers);
  const [title, setTitle] = useState(detail.form.title);
  const [dirty, setDirty] = useState(false);
  const version = detail.version;
  const editable = detail.canEdit;

  // After a save, sign or submit the server's copy is the truth for anything not being edited.
  useEffect(() => {
    if (!dirty) {
      setAnswers(detail.answers);
      setTitle(detail.form.title);
    }
  }, [detail, dirty]);

  const errors = useMemo(
    () => ({ ...serverFieldErrors(save.error), ...serverFieldErrors(submit.error) }),
    [save.error, submit.error],
  );

  const change = (key: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setDirty(true);
  };

  async function saveNow(): Promise<number> {
    if (!dirty) return version;
    const saved = await save.mutateAsync({ version, title, answers });
    setDirty(false);
    return saved.version;
  }

  const busy = save.isPending || sign.isPending || submit.isPending;
  const link = detail.linkModule;

  return (
    <>
      <PageHeader
        eyebrow={detail.form.numberLabel}
        title={detail.form.title}
        description={
          <>
            {detail.templateName} · Created by {detail.form.createdByName},{' '}
            {formatInstant(detail.form.createdAt, timeZone)}
          </>
        }
        actions={
          <StatusPill tone={detail.form.status === 'submitted' ? 'success' : 'neutral'}>
            {detail.form.status === 'submitted' ? 'Submitted' : 'Draft'}
          </StatusPill>
        }
      />
      <p>
        <Link href={webRoutes.forms(orgSlug, projectId)}>All forms</Link>
        {link ? (
          <>
            {' · '}
            <Link href={LINK_ROUTE[link](orgSlug, projectId)}>Goes with {LINK_LABELS[link]}</Link>
          </>
        ) : null}
      </p>
      {detail.flags.length > 0 ? (
        <Alert tone="warning" title="Nova flagged this form">
          <ul className="forms__flags">
            {detail.flags.map((f) => (
              <li key={f.kind}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <ErrorAlert error={save.error} title="We couldn't save the form" />
      <ErrorAlert error={sign.error} title="We couldn't add the signature" />
      <ErrorAlert error={submit.error} title="We couldn't submit the form" />
      <form
        className="stack forms__body"
        onSubmit={(e) => {
          e.preventDefault();
          void saveNow().catch(() => undefined);
        }}
      >
        <TextField
          label="Title"
          value={title}
          maxLength={200}
          disabled={!editable}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        {detail.fields.map((f) => {
          if (f.type === 'heading')
            return (
              <div key={f.key} className="forms__heading">
                <h2>{f.label}</h2>
                {f.help ? <p>{f.help}</p> : null}
              </div>
            );
          if (f.type === 'signature')
            return (
              <SignatureBlock
                key={f.key}
                field={f}
                signatures={detail.signatures.filter((s) => s.fieldKey === f.key)}
                editable={editable}
                busy={busy}
                timeZone={timeZone}
                error={errors[`answers/${f.key}`]}
                onSign={async (name) => {
                  await saveNow();
                  await sign.mutateAsync({ fieldKey: f.key, signerName: name });
                }}
              />
            );
          return (
            <FieldInput
              key={f.key}
              field={f}
              value={answers[f.key]}
              disabled={!editable}
              error={errors[`answers/${f.key}`]}
              onChange={(v) => change(f.key, v)}
            />
          );
        })}
        {editable ? (
          <div className="row-actions">
            <Button
              type="submit"
              variant="secondary"
              loading={save.isPending}
              disabled={!dirty || busy}
            >
              Save draft
            </Button>
            <Button
              type="button"
              loading={submit.isPending}
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const v = await saveNow();
                  await submit.mutateAsync(v);
                })().catch(() => undefined);
              }}
            >
              Submit
            </Button>
          </div>
        ) : (
          <p className="u-caption">
            Submitted{' '}
            {detail.form.submittedAt ? formatInstant(detail.form.submittedAt, timeZone) : ''}. A
            submitted form can't be changed.
          </p>
        )}
      </form>
    </>
  );
}

function SignatureBlock({
  field,
  signatures,
  editable,
  busy,
  timeZone,
  error,
  onSign,
}: {
  field: FormDetail['fields'][number];
  signatures: FormDetail['signatures'];
  editable: boolean;
  busy: boolean;
  timeZone: string;
  error?: string | undefined;
  onSign: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const slots = field.slots ?? 1;
  const full = signatures.length >= slots;
  return (
    <fieldset className="forms__group">
      <legend>
        {field.label}
        {field.required ? ' (required)' : ''}
      </legend>
      {field.help ? <p className="u-caption">{field.help}</p> : null}
      <ol className="forms__signatures">
        {Array.from({ length: Math.min(slots, Math.max(signatures.length + 1, 3)) }, (_, i) => {
          const s = signatures[i];
          return (
            <li key={i} className={s ? 'forms__signed' : 'forms__slot'}>
              {s ? (
                <>
                  <strong>{s.signerName}</strong>
                  <span className="u-caption">{formatInstant(s.signedAt, timeZone)}</span>
                </>
              ) : (
                <span className="u-caption">Empty</span>
              )}
            </li>
          );
        })}
      </ol>
      {editable && !full ? (
        <div className="forms__sign">
          <TextField
            label="Name of person signing"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || name.trim().length === 0}
            onClick={() => {
              void onSign(name.trim())
                .then(() => setName(''))
                .catch(() => undefined);
            }}
          >
            Sign
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
