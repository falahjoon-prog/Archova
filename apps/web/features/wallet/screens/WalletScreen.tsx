'use client';

import { InductionsIcon as ShieldCheck } from '@archova/ui/icons';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type StatusTone,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useFeatureFlag } from '@/shared/hooks/useFeatureFlag';
import { isApiError } from '@/shared/lib/errors';
import { formatLocalDate, formatMoney } from '@/shared/lib/format';
import { serverFieldErrors } from '@/shared/lib/forms';
import { fileDownloadUrl } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useDocuments, useExpiryAlerts, useWalletMutations } from '../hooks/useWallet';
import { SharingSection } from './SharingSection';
import {
  centsToDollars,
  dollarsToCents,
  emptyForm,
  EVIDENCE_LABELS,
  EXPIRY_LABELS,
  INSURANCE_TYPES,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  LICENCE_TYPES,
  STATES,
  alertLabel,
  NUMBER_CHECK_HINT,
  NUMBER_CHECK_LABEL,
  type ComplianceDocument,
  type DocumentForm,
  type Expiry,
  type ItemType,
} from '../lib/types';

const EXPIRY_TONE: Record<Expiry, StatusTone> = {
  no_expiry: 'neutral',
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
};

const MAX_FILES = 4;

const toForm = (d: ComplianceDocument): DocumentForm => ({
  itemType: d.itemType,
  title: d.title,
  number: '',
  issuingState: d.issuingState ?? '',
  licenceClass: d.licenceClass ?? '',
  insurer: d.insurer ?? '',
  limit: centsToDollars(d.limitCents),
  startsOn: d.startsOn ?? '',
  expiresOn: d.expiresOn ?? '',
  selfDeclared: d.evidence === 'self_declared',
});

/** Fields that only apply to some kinds of document are hidden for the others. */
const isInsurance = (t: ItemType) => INSURANCE_TYPES.includes(t);
const isLicence = (t: ItemType) => LICENCE_TYPES.includes(t);

function DocumentDialog({
  doc,
  onClose,
}: {
  /** The document being edited, or `null` for a new one. */
  doc: ComplianceDocument | null;
  onClose: () => void;
}) {
  const m = useWalletMutations();
  const [form, setForm] = useState<DocumentForm>(doc ? toForm(doc) : emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const mutation = doc ? m.update : m.create;
  const server = serverFieldErrors(mutation.error);
  const set = <K extends keyof DocumentForm>(k: K, v: DocumentForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const existing = doc?.fileIds.length ?? 0;
  const declared = !doc && form.selfDeclared;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    const title = form.title.trim();
    if (!title) return setProblem('Give the document a title.');
    const cents = dollarsToCents(form.limit);
    if (Number.isNaN(cents)) return setProblem('Enter the cover limit as a dollar amount.');
    if (form.startsOn && form.expiresOn && form.expiresOn < form.startsOn)
      return setProblem('The expiry date is before the start date.');
    if (!doc && !declared && files.length === 0)
      return setProblem('Add a file, or tick “No document, a declaration only”.');
    if (existing + files.length > MAX_FILES)
      return setProblem(`A document can have up to ${MAX_FILES} files.`);

    const number = form.number.trim();
    if (doc) {
      m.update.mutate(
        {
          doc,
          files,
          body: {
            title,
            ...(number ? { number } : {}),
            issuingState: form.issuingState || null,
            licenceClass: form.licenceClass.trim() || null,
            insurer: form.insurer.trim() || null,
            limitCents: cents,
            startsOn: form.startsOn || null,
            expiresOn: form.expiresOn || null,
          },
        },
        { onSuccess: onClose },
      );
      return;
    }
    m.create.mutate(
      {
        files,
        body: {
          itemType: form.itemType,
          title,
          ...(number ? { number } : {}),
          ...(form.issuingState ? { issuingState: form.issuingState } : {}),
          ...(form.licenceClass.trim() ? { licenceClass: form.licenceClass.trim() } : {}),
          ...(form.insurer.trim() ? { insurer: form.insurer.trim() } : {}),
          ...(cents !== null ? { limitCents: cents } : {}),
          ...(form.startsOn ? { startsOn: form.startsOn } : {}),
          ...(form.expiresOn ? { expiresOn: form.expiresOn } : {}),
          selfDeclared: declared,
        },
      },
      { onSuccess: onClose },
    );
  }

  const showInsurer = isInsurance(form.itemType) || form.itemType === 'subcontractor_statement';
  const showLicence = isLicence(form.itemType);

  return (
    <Dialog
      open
      onClose={onClose}
      title={doc ? 'Edit document' : 'Add a document'}
      description="Archova records what you tell it. Nothing here is checked against a register."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="wallet-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : doc ? 'Save changes' : 'Add document'}
          </Button>
        </>
      }
    >
      <form id="wallet-form" className="stack" onSubmit={onSubmit} noValidate>
        <Select
          label="Type"
          value={form.itemType}
          onChange={(e) => set('itemType', e.target.value as ItemType)}
          options={ITEM_TYPES.map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))}
          disabled={doc !== null}
          hint={doc ? 'The type can’t be changed. Archive this and add a new one.' : undefined}
        />
        <TextField
          label="Title"
          hint="How you will recognise it, such as “Public liability 2026–27”."
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          error={server.title}
          maxLength={200}
          required
        />
        <TextField
          label="Number"
          hint={
            doc?.numberLast4
              ? `Ends in ${doc.numberLast4}. Leave blank to keep it. Only the last four characters are kept.`
              : 'Licence, policy or card number. Only the last four characters are kept.'
          }
          value={form.number}
          onChange={(e) => set('number', e.target.value)}
          error={server.number}
          maxLength={50}
          autoComplete="off"
        />
        {showInsurer ? (
          <TextField
            label="Insurer"
            value={form.insurer}
            onChange={(e) => set('insurer', e.target.value)}
            error={server.insurer}
            maxLength={200}
          />
        ) : null}
        {isInsurance(form.itemType) ? (
          <TextField
            label="Cover limit (AUD)"
            inputMode="decimal"
            value={form.limit}
            onChange={(e) => set('limit', e.target.value)}
            error={server.limitCents}
          />
        ) : null}
        {showLicence ? (
          <>
            <Select
              label="Issuing state"
              value={form.issuingState}
              onChange={(e) => set('issuingState', e.target.value as DocumentForm['issuingState'])}
              placeholder="Not stated"
              options={STATES.map((s) => ({ value: s, label: s }))}
            />
            <TextField
              label="Class or conditions"
              value={form.licenceClass}
              onChange={(e) => set('licenceClass', e.target.value)}
              error={server.licenceClass}
              maxLength={200}
            />
          </>
        ) : null}
        <TextField
          label="Starts on"
          type="date"
          value={form.startsOn}
          onChange={(e) => set('startsOn', e.target.value)}
          error={server.startsOn}
        />
        <TextField
          label="Expires on"
          type="date"
          value={form.expiresOn}
          onChange={(e) => set('expiresOn', e.target.value)}
          error={server.expiresOn}
        />
        {!doc ? (
          <Checkbox
            label="No document, a declaration only"
            checked={form.selfDeclared}
            onChange={(e) => {
              set('selfDeclared', e.target.checked);
              if (e.target.checked) setFiles([]);
            }}
          />
        ) : null}
        {!declared && doc?.evidence !== 'self_declared' ? (
          <div className="stack">
            <TextField
              label={doc ? 'Add files' : 'Files'}
              hint={`PDF or photo, up to ${MAX_FILES} files${doc ? `, ${existing} already attached` : ''}. Each is checked for viruses.`}
              type="file"
              accept="application/pdf,image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              error={server.fileIds}
            />
            {doc ? (
              <p className="u-caption">
                Changing what a document says clears its “Sighted” mark, because a new version has
                not been looked at.
              </p>
            ) : null}
          </div>
        ) : null}
        {problem ? <Alert tone="danger" title={problem} /> : null}
        {mutation.isError && !Object.keys(server).length ? (
          <ErrorAlert
            error={mutation.error}
            title={
              isApiError(mutation.error, 409)
                ? 'Someone changed this document. Close this and try again.'
                : 'We couldn’t save the document'
            }
          />
        ) : null}
      </form>
    </Dialog>
  );
}

function ViewFiles({ doc }: { doc: ComplianceDocument }) {
  const { orgId } = useCurrentOrg();
  const [error, setError] = useState<string | null>(null);
  if (!doc.fileIds.length) return null;
  async function open(fileId: string) {
    setError(null);
    try {
      window.open(await fileDownloadUrl(orgId, fileId), '_blank', 'noopener');
    } catch {
      setError('We couldn’t open that file.');
    }
  }
  return (
    <>
      {doc.fileIds.map((id, i) => (
        <Button key={id} variant="secondary" onClick={() => open(id)}>
          View file {doc.fileIds.length > 1 ? i + 1 : ''}
          <span className="u-visually-hidden"> of {doc.title}</span>
        </Button>
      ))}
      {error ? <span className="u-caption">{error}</span> : null}
    </>
  );
}

function DocumentRow({
  doc,
  onEdit,
}: {
  doc: ComplianceDocument;
  onEdit: (d: ComplianceDocument) => void;
}) {
  const { user } = useCurrentOrg();
  const m = useWalletMutations();
  const archived = doc.archivedAt !== null;
  const busy = m.archive.isPending || m.sight.isPending;
  const error = m.archive.error ?? m.sight.error;
  const details = [
    doc.numberLast4 ? `Number ends in ${doc.numberLast4}` : null,
    doc.insurer,
    doc.limitCents !== null
      ? `Cover ${formatMoney({ amount: (doc.limitCents / 100).toFixed(2), currency: 'AUD' })}`
      : null,
    doc.issuingState,
    doc.licenceClass,
  ].filter(Boolean);
  const evidence =
    doc.evidence === 'sighted' && doc.sightedAt
      ? `Sighted by ${doc.sightedBy === user.id ? 'you' : 'a team member'} on ${formatLocalDate(doc.sightedAt.slice(0, 10))}`
      : EVIDENCE_LABELS[doc.evidence];

  return (
    <li className="wallet__row">
      <div className="wallet__head">
        <strong>{doc.title}</strong>
        <span className="wallet__pills">
          <StatusPill tone={EXPIRY_TONE[doc.expiry]}>{EXPIRY_LABELS[doc.expiry]}</StatusPill>
          {doc.numberCheck === 'format_ok' ? (
            <span title={NUMBER_CHECK_HINT}>
              <StatusPill tone="info">{NUMBER_CHECK_LABEL}</StatusPill>
              <span className="u-visually-hidden">. {NUMBER_CHECK_HINT}</span>
            </span>
          ) : null}
          {archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
        </span>
      </div>
      <span className="u-caption">
        {ITEM_TYPE_LABELS[doc.itemType]}
        {details.length ? ` · ${details.join(' · ')}` : ''}
      </span>
      <span className="u-caption">
        {doc.startsOn ? `From ${formatLocalDate(doc.startsOn)} · ` : ''}
        {doc.expiresOn ? `Expires ${formatLocalDate(doc.expiresOn)}` : 'No expiry date'} ·{' '}
        {evidence}
      </span>
      <div className="wallet__actions">
        {!archived ? (
          <>
            <Button variant="secondary" onClick={() => onEdit(doc)}>
              Edit<span className="u-visually-hidden"> {doc.title}</span>
            </Button>
            {doc.evidence === 'recorded' ? (
              <Button variant="secondary" disabled={busy} onClick={() => m.sight.mutate(doc)}>
                Mark sighted<span className="u-visually-hidden"> {doc.title}</span>
              </Button>
            ) : null}
          </>
        ) : null}
        <ViewFiles doc={doc} />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => m.archive.mutate({ doc, archived: !archived })}
        >
          {archived ? 'Restore' : 'Archive'}
          <span className="u-visually-hidden"> {doc.title}</span>
        </Button>
      </div>
      {error ? <ErrorAlert error={error} title="We couldn’t update the document" /> : null}
    </li>
  );
}

const alertTone = (t: number): StatusTone => (t <= 0 ? 'danger' : 'warning');

function AlertsCard() {
  const alerts = useExpiryAlerts();
  // Nothing to say, and nothing to fail loudly about: the documents list below is the main job.
  if (alerts.isPending || (alerts.data && alerts.data.length === 0)) return null;
  return (
    <Card title="Expiry alerts">
      <div className="stack">
        {alerts.isError ? (
          isApiError(alerts.error, 403) ? null : (
            <ErrorAlert error={alerts.error} title="We couldn’t load the expiry alerts" />
          )
        ) : null}
        {alerts.data?.length ? (
          <ul className="wallet__list">
            {alerts.data.map((a) => (
              <li key={a.id} className="wallet__row">
                <div className="wallet__head">
                  <strong>{a.title}</strong>
                  <StatusPill tone={alertTone(a.threshold)}>{alertLabel(a.threshold)}</StatusPill>
                </div>
                <span className="u-caption">
                  {ITEM_TYPE_LABELS[a.itemType]} · Expires {formatLocalDate(a.expiresOn)} · Raised{' '}
                  {formatLocalDate(a.raisedOn)}
                  {a.documentArchived ? ' · Archived' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

export function WalletScreen() {
  const enabled = useFeatureFlag('subcontractor_wallet');
  const [itemType, setItemType] = useState<ItemType | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<{ doc: ComplianceDocument | null } | null>(null);
  const docs = useDocuments({ ...(itemType ? { itemType } : {}), includeArchived });

  if (!enabled) {
    return (
      <>
        <PageHeader title="Compliance wallet" />
        <EmptyState
          icon={ShieldCheck}
          title="The compliance wallet isn’t switched on for this company"
          description="Ask Archova support to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Compliance wallet"
        description="Your insurance, licence and card documents, soonest expiry first. A site manager can mark one “Sighted” after looking at the original. Archova never calls a document “verified”."
        actions={<Button onClick={() => setDialog({ doc: null })}>Add document</Button>}
      />
      <AlertsCard />
      <Card title="Documents">
        <div className="stack">
          <div className="wallet__filters">
            <Select
              label="Type"
              value={itemType}
              onChange={(e) => setItemType(e.target.value as ItemType | '')}
              placeholder="All types"
              options={ITEM_TYPES.map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))}
            />
            <Checkbox
              label="Show archived"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
          </div>
          {docs.isPending ? <SkeletonRows rows={3} label="Loading documents…" /> : null}
          {docs.isError ? (
            isApiError(docs.error, 403) ? (
              <p className="u-muted">You don’t have access to this company’s wallet.</p>
            ) : (
              <ErrorAlert error={docs.error} title="We couldn’t load the wallet" />
            )
          ) : null}
          {docs.data && docs.data.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No documents yet"
              description="Add your licences and insurance certificates so builders can see they are current."
              action={<Button onClick={() => setDialog({ doc: null })}>Add document</Button>}
            />
          ) : null}
          {docs.data?.length ? (
            <ul className="wallet__list">
              {docs.data.map((d) => (
                <DocumentRow key={d.id} doc={d} onEdit={(doc) => setDialog({ doc })} />
              ))}
            </ul>
          ) : null}
        </div>
      </Card>
      <SharingSection />
      {dialog ? <DocumentDialog doc={dialog.doc} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
