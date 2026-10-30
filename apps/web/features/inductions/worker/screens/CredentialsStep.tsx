'use client';

import { useState } from 'react';
import { Button, CredentialCaptureCard, Select, TextField } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useInductionSource, useProgressMutation } from '../hooks/useInduction';
import { compressPhoto } from '@/shared/lib/compress-photo';
import { stepNumber, totalSteps } from '../lib/flow';
import type { CredentialType, WorkerCredential } from '../lib/types';
import { StickyButton, WorkerShell } from '../components/WorkerShell';
import type { StepProps } from './types';

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => ({
  value: s,
  label: s,
}));

/** Common high-risk work licence classes and trade licences; anything else goes in as typed. */
const LICENCES = [
  'High-risk work licence: EWP (WP)',
  'High-risk work licence: forklift (LF)',
  'High-risk work licence: dogging (DG)',
  'High-risk work licence: basic rigging (RB)',
  'High-risk work licence: scaffolding (SB)',
  'Electrical licence',
  'Plumbing licence',
].map((l) => ({ value: l, label: l }));

const PHOTO_NOTE =
  'Your site managers, safety team and your employer can see these photos. Gate staff only see whether your ticket is current. Photos are deleted 12 months after the ticket expires or your work with the builder ends.';

/**
 * B5: the white card (required) and any licences, each with a photo, number and expiry. Saved as "Recorded"; a
 * site manager may later mark it "Sighted". Never "Verified" (IND-AC7).
 */
export function CredentialsStep({ opened, go, online }: StepProps) {
  const { site, induction, progress } = opened;
  const whiteCard = progress.credentials.find((c) => c.type === 'white_card');
  const licences = progress.credentials.filter((c) => c.type !== 'white_card');
  const [adding, setAdding] = useState(false);

  return (
    <WorkerShell
      site={site}
      step={{
        current: stepNumber({ kind: 'credentials' }, induction),
        total: totalSteps(induction),
      }}
      online={online}
      saveState="saved"
      footer={
        <StickyButton
          back={() => go({ kind: 'quiz' })}
          blocked={!whiteCard}
          onClick={() => go({ kind: 'declaration' })}
        >
          {whiteCard ? 'Next' : 'Add your white card to continue'}
        </StickyButton>
      }
    >
      <div className="stack">
        <h1 className="worker-title">Your tickets</h1>
        <CredentialForm
          opened={opened}
          type="white_card"
          label="White card"
          existing={whiteCard}
          required
        />
        {induction.requiredLicences.map((l) => (
          <CredentialForm
            key={l}
            opened={opened}
            type="hrwl"
            label={l}
            existing={licences.find((c) => c.label === l)}
            required
          />
        ))}
        {licences
          .filter((c) => !induction.requiredLicences.includes(c.label))
          .map((c) => (
            <CredentialForm key={c.id} opened={opened} type={c.type} label={c.label} existing={c} />
          ))}
        {adding ? (
          <CredentialForm opened={opened} type="hrwl" label="" onSaved={() => setAdding(false)} />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={20} aria-hidden="true" /> Add a licence
            </Button>
          </div>
        )}
      </div>
    </WorkerShell>
  );
}

function CredentialForm({
  opened,
  type,
  label,
  existing,
  required,
  onSaved,
}: {
  opened: StepProps['opened'];
  type: CredentialType;
  /** Empty for a new licence: the worker picks the type. */
  label: string;
  existing?: WorkerCredential | undefined;
  required?: boolean;
  onSaved?: () => void;
}) {
  const source = useInductionSource();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [kind, setKind] = useState(label);
  const [number, setNumber] = useState(existing?.number ?? '');
  const [state, setState] = useState(existing?.state ?? '');
  const [expiry, setExpiry] = useState(existing?.expiry ?? '');
  const [editing, setEditing] = useState(!existing);
  const save = useProgressMutation(async (sid, _: null) =>
    source.saveCredential(sid, {
      type,
      label: type === 'white_card' ? 'White card' : kind,
      number,
      state: type === 'white_card' ? state || null : null,
      expiry: type === 'white_card' ? null : expiry || null,
      photo: photo ? await compressPhoto(photo) : null,
    }),
  );
  const isWhiteCard = type === 'white_card';
  const title = isWhiteCard ? 'White card' : kind || 'Licence';

  if (existing && !editing) {
    return (
      <CredentialCaptureCard
        title={title}
        required={required}
        status={existing.status}
        photo={photo}
        onPhoto={(f) => {
          setPhoto(f);
          setEditing(true);
        }}
        note={
          <>
            On file: {existing.number}
            {existing.state ? ` (${existing.state})` : ''}
            {existing.expiry ? `, expires ${formatLocalDate(existing.expiry)}` : ''}. Still current?
            Update it if it&apos;s changed.
          </>
        }
      >
        <div>
          <Button variant="tertiary" onClick={() => setEditing(true)}>
            Update {title.toLowerCase()}
          </Button>
        </div>
      </CredentialCaptureCard>
    );
  }

  return (
    <CredentialCaptureCard
      title={title}
      required={required}
      status={existing?.status ?? 'missing'}
      photo={photo}
      onPhoto={setPhoto}
      note={PHOTO_NOTE}
    >
      {!isWhiteCard && !label ? (
        <Select
          label="Licence type"
          placeholder="Choose a licence"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={LICENCES}
        />
      ) : null}
      <TextField
        label={isWhiteCard ? 'White card number' : 'Licence number'}
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />
      {isWhiteCard ? (
        <Select
          label="State issued"
          placeholder="Choose a state"
          value={state}
          onChange={(e) => setState(e.target.value)}
          options={STATES}
        />
      ) : (
        <TextField
          label="Expiry date"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      )}
      <ErrorAlert error={save.error} title="That didn't save" />
      <div>
        <Button
          loading={save.isPending}
          disabled={!isWhiteCard && !kind}
          onClick={() =>
            save.mutate(
              { sessionId: opened.sessionId, args: null },
              {
                onSuccess: () => {
                  setEditing(false);
                  onSaved?.();
                },
              },
            )
          }
        >
          Save {title.toLowerCase()}
        </Button>
      </div>
    </CredentialCaptureCard>
  );
}
