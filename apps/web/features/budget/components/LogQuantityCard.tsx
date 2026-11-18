'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useLogQuantity, useQuantityLog } from '../hooks/useBudget';

/**
 * Quantity put in place on a cost code, entered by day as the work goes in. Entries add to the quantity in place and
 * are never edited; a correction is a negative entry with a note.
 */
export function LogQuantityCard({
  costCodeId,
  code,
  uom,
  onDone,
}: {
  costCodeId: string;
  code: string;
  uom: string | null;
  onDone: () => void;
}) {
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const log = useLogQuantity(project.projectId);
  const history = useQuantityLog(project.projectId, costCodeId);
  const [loggedOn, setLoggedOn] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = Number(quantity.trim());
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(quantity.trim()) || q === 0)
      return setError('Enter the quantity put in place, like 12.5. Use a minus to correct.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(loggedOn))
      return setError('Enter the day it was put in place.');
    if (loggedOn > today) return setError('Quantity cannot be logged for a future day.');
    if (q < 0 && !note.trim()) return setError('Say why the quantity is being taken off.');
    log.mutate(
      {
        costCodeId,
        body: { loggedOn, quantity: q, ...(note.trim() ? { note: note.trim() } : {}) },
      },
      {
        onSuccess: () => {
          setQuantity('');
          setNote('');
        },
      },
    );
  }

  return (
    <Card title={`Log quantity for ${code}`}>
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="form-row">
          <TextField
            label="Day"
            type="date"
            required
            max={today}
            value={loggedOn}
            onChange={(e) => setLoggedOn(e.target.value)}
          />
          <TextField
            label={`Quantity put in place${uom ? ` (${uom})` : ''}`}
            inputMode="decimal"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={log.error} title="We couldn't log that quantity" />
        <div className="row-actions">
          <Button type="submit" disabled={log.isPending}>
            Log quantity
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Close
          </Button>
        </div>
      </form>
      {history.data && history.data.length > 0 ? (
        <ul className="stack-sm u-m-0">
          {history.data.slice(0, 8).map((e) => (
            <li key={e.id} className="u-caption">
              {formatLocalDate(e.loggedOn)}: <span className="u-mono">{e.quantity}</span>
              {uom ? ` ${uom}` : ''}
              {e.note ? ` – ${e.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
