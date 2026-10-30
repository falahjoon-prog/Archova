'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  PageHeader,
  Select,
  SkeletonRows,
  TextField,
  Textarea,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useSendable, useTransmittalMutations } from '../hooks/useTransmittals';
import {
  PURPOSES,
  PURPOSE_LABELS,
  parseRecipients,
  type Sendable,
  type TransmittalPurpose,
} from '../lib/types';

type Pick = { revisionType: 'document' | 'drawing'; revisionId: string };
const key = (p: Pick) => `${p.revisionType}:${p.revisionId}`;

/** F1.6: pick revisions (or the current set for a discipline), recipients, purpose and a message, then save a draft. */
export function TransmittalNewScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const router = useRouter();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'transmittals', id: 'new' },
  });
  const sendable = useSendable(project.projectId);
  const sheets = (sendable.data ?? []).filter((i) => i.revisionType === 'drawing');
  const docs = (sendable.data ?? []).filter((i) => i.revisionType === 'document');
  const { create } = useTransmittalMutations(project.projectId);
  const [subject, setSubject] = useState('');
  const [purpose, setPurpose] = useState<TransmittalPurpose>('for_information');
  const [message, setMessage] = useState('');
  const [responseDue, setResponseDue] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [picked, setPicked] = useState<Map<string, Pick>>(new Map());
  const [disciplines, setDisciplines] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  const availableDisciplines = useMemo(
    () =>
      [
        ...new Set((sendable.data ?? []).map((s) => s.discipline).filter((d): d is string => !!d)),
      ].sort(),
    [sendable.data],
  );
  const toList = parseRecipients(to);
  const ccList = parseRecipients(cc);
  const itemCount = picked.size + disciplines.size;
  const errors = {
    subject: !subject.trim() ? 'Enter a subject.' : undefined,
    to: !toList.emails.length
      ? 'Add at least one email address.'
      : toList.invalid.length
        ? `Not an email address: ${toList.invalid.join(', ')}`
        : undefined,
    cc: ccList.invalid.length ? `Not an email address: ${ccList.invalid.join(', ')}` : undefined,
    items: itemCount === 0 ? 'Choose at least one drawing or document.' : undefined,
  };
  const valid = !errors.subject && !errors.to && !errors.cc && !errors.items;

  const toggle = (p: Pick) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(key(p))) next.delete(key(p));
      else next.set(key(p), p);
      return next;
    });

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const ccOnly = ccList.emails.filter(
      (e) => !toList.emails.some((t) => t.toLowerCase() === e.toLowerCase()),
    );
    create.mutate(
      {
        subject: subject.trim(),
        purpose,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(responseDue ? { responseDue } : {}),
        recipients: [
          ...toList.emails.map((email) => ({ email, role: 'to' as const })),
          ...ccOnly.map((email) => ({ email, role: 'cc' as const })),
        ],
        items: [...picked.values()],
        ...(disciplines.size ? { currentSetDisciplines: [...disciplines] } : {}),
      },
      {
        onSuccess: (d) =>
          router.push(webRoutes.transmittal(org.orgSlug, project.projectId, d.transmittal.id)),
      },
    );
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.transmittals(org.orgSlug, project.projectId)}>
            Transmittals
          </Link>
        }
        title="New transmittal"
        description="Save a draft, check it, then send. Once sent it can't be changed."
      />
      <form
        className="stack-lg"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="ac-card stack" aria-labelledby="tx-details">
          <h2 id="tx-details" className="panel-heading">
            Details
          </h2>
          <TextField
            label="Subject"
            value={subject}
            maxLength={300}
            onChange={(e) => setSubject(e.target.value)}
            error={touched ? errors.subject : undefined}
          />
          <div className="form-row">
            <Select
              label="Purpose"
              value={purpose}
              options={PURPOSES.map((v) => ({ value: v, label: PURPOSE_LABELS[v] }))}
              onChange={(e) => setPurpose(e.target.value as TransmittalPurpose)}
            />
            <TextField
              label="Response due"
              type="date"
              value={responseDue}
              onChange={(e) => setResponseDue(e.target.value)}
              hint="Optional"
            />
          </div>
          <Textarea
            label="Message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            hint="Optional. It appears on the cover sheet and in the email."
          />
        </section>

        <section className="ac-card stack" aria-labelledby="tx-people">
          <h2 id="tx-people" className="panel-heading">
            Who it goes to
          </h2>
          <Textarea
            label="To"
            rows={2}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            hint="Email addresses, separated by commas or new lines. People without an Archova account get a personal link."
            error={touched ? errors.to : undefined}
          />
          <Textarea
            label="Cc"
            rows={2}
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            hint="Optional"
            error={touched ? errors.cc : undefined}
          />
        </section>

        <section className="ac-card stack" aria-labelledby="tx-items">
          <h2 id="tx-items" className="panel-heading">
            What you are sending
          </h2>
          {touched && errors.items ? <p className="ac-field__error">{errors.items}</p> : null}
          {availableDisciplines.length ? (
            <fieldset className="check-group">
              <legend className="ac-field__label">Current set for a discipline</legend>
              {availableDisciplines.map((d) => (
                <Checkbox
                  key={d}
                  label={`Discipline ${d}`}
                  hint="Every current sheet"
                  checked={disciplines.has(d)}
                  onChange={(e) =>
                    setDisciplines((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(d);
                      else next.delete(d);
                      return next;
                    })
                  }
                />
              ))}
            </fieldset>
          ) : null}
          <fieldset className="check-group">
            <legend className="ac-field__label">Drawings</legend>
            {sendable.isPending ? <SkeletonRows rows={3} label="Loading drawings…" /> : null}
            <ErrorAlert error={sendable.error} title="We couldn't load drawings and documents" />
            {sheets.map((s) => (
              <SendableCheck
                key={s.revisionId}
                item={s}
                checked={picked.has(key(s))}
                onToggle={toggle}
              />
            ))}
            {!sendable.isPending && sheets.length === 0 ? (
              <p className="u-caption">No drawings published yet.</p>
            ) : null}
          </fieldset>
          <fieldset className="check-group">
            <legend className="ac-field__label">Documents</legend>
            {docs.map((d) => (
              <SendableCheck
                key={d.revisionId}
                item={d}
                checked={picked.has(key(d))}
                onToggle={toggle}
              />
            ))}
            {!sendable.isPending && docs.length === 0 ? (
              <p className="u-caption">No documents yet.</p>
            ) : null}
          </fieldset>
        </section>

        <ErrorAlert error={create.error} title="We couldn't save the transmittal" />
        <div className="row-actions">
          <Button type="submit" loading={create.isPending}>
            Save draft
          </Button>
          <Link className="link" href={webRoutes.transmittals(org.orgSlug, project.projectId)}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function SendableCheck({
  item,
  checked,
  onToggle,
}: {
  item: Sendable;
  checked: boolean;
  onToggle: (p: Pick) => void;
}) {
  return (
    <Checkbox
      label={
        <span>
          {item.number ? <span className="u-mono">{item.number}</span> : null} {item.title}
        </span>
      }
      hint={`Rev ${item.rev}`}
      checked={checked}
      onChange={() => onToggle({ revisionType: item.revisionType, revisionId: item.revisionId })}
    />
  );
}
