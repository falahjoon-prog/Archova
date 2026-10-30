'use client';

import { useState, type ReactNode } from 'react';
import { Button, Dialog, FormError, Textarea, TextField } from '@archova/ui';

/** Every account action needs a reason (5+ characters) and a ticket reference (backend 09 §3). */
export function OrgActionDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  fields,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The action's own inputs, shown above the reason. */
  fields?: ReactNode;
  onClose: () => void;
  onConfirm: (input: { reason: string; ticketRef: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 5 && ticketRef.trim().length >= 2;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim(), ticketRef: ticketRef.trim() });
      setReason('');
      setTicketRef('');
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
      <div className="stack">
        {fields}
        <TextField
          label="Ticket reference"
          value={ticketRef}
          onChange={(e) => setTicketRef(e.target.value)}
          hint="For example SUP-123."
        />
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="At least 5 characters. The customer's audit log shows it."
        />
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
