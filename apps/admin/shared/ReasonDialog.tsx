'use client';

import { useState, type ReactNode } from 'react';
import { Button, Dialog, FormError, Textarea } from '@archova/ui';

/** Asks for a short reason (5+ characters) before a change is proposed or a request is rejected. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  danger,
  label = 'Reason',
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  label?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 5;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => void go()}
            loading={busy}
            disabled={!valid}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea
        label={label}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="At least 5 characters. It is kept in the action log."
      />
      <FormError message={error} />
    </Dialog>
  );
}
