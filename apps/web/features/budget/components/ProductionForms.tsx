'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useCreateProductionItem,
  useLogProductionEntry,
  useProductionEntries,
} from '../hooks/useBudget';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Defines a production item: any unit the project wants to track, with its planned quantity and window. */
export function ProductionItemForm({ onDone }: { onDone: () => void }) {
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const create = useCreateProductionItem(project.projectId);
  const [f, setF] = useState({
    name: '',
    uom: '',
    trade: '',
    location: '',
    qty: '',
    start: today,
    finish: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(f.qty.trim());
    if (!f.name.trim()) return setError('Name what is being installed, like "Panels installed".');
    if (!f.uom.trim()) return setError('Enter the unit, like panels, LF or CY.');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(f.qty.trim()) || qty <= 0)
      return setError('Enter the planned quantity, more than zero.');
    if (!DATE.test(f.start) || !DATE.test(f.finish)) return setError('Enter the start and finish.');
    if (f.finish < f.start) return setError('Finish cannot be before the start.');
    create.mutate(
      {
        name: f.name.trim(),
        uom: f.uom.trim(),
        ...(f.trade.trim() ? { trade: f.trade.trim() } : {}),
        ...(f.location.trim() ? { location: f.location.trim() } : {}),
        plannedQuantity: qty,
        plannedStart: f.start,
        plannedFinish: f.finish,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Card title="New production item">
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="form-row">
          <TextField label="Name" required value={f.name} onChange={set('name')} />
          <TextField label="Unit" required value={f.uom} onChange={set('uom')} />
        </div>
        <div className="form-row">
          <TextField label="Trade" value={f.trade} onChange={set('trade')} />
          <TextField label="Location" value={f.location} onChange={set('location')} />
        </div>
        <div className="form-row">
          <TextField
            label="Planned quantity"
            inputMode="decimal"
            required
            value={f.qty}
            onChange={set('qty')}
          />
          <TextField
            label="Planned start"
            type="date"
            required
            value={f.start}
            onChange={set('start')}
          />
          <TextField
            label="Planned finish"
            type="date"
            required
            value={f.finish}
            onChange={set('finish')}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={create.error} title="We couldn't save that item" />
        <div className="row-actions">
          <Button type="submit" disabled={create.isPending}>
            Save item
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Quantity installed for a day, optionally for a named crew. Entries are never edited; a correction is negative with a note. */
export function LogProductionCard({
  itemId,
  name,
  uom,
  onDone,
}: {
  itemId: string;
  name: string;
  uom: string;
  onDone: () => void;
}) {
  const project = useCurrentProject();
  const today = todayIn(project.timezone);
  const log = useLogProductionEntry(project.projectId);
  const history = useProductionEntries(project.projectId, itemId);
  const [loggedOn, setLoggedOn] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [crew, setCrew] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = Number(quantity.trim());
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(quantity.trim()) || q === 0)
      return setError('Enter the quantity installed, like 12.5. Use a minus to correct.');
    if (!DATE.test(loggedOn)) return setError('Enter the day it was installed.');
    if (loggedOn > today) return setError('Quantity cannot be logged for a future day.');
    if (q < 0 && !note.trim()) return setError('Say why the quantity is being taken off.');
    log.mutate(
      {
        itemId,
        body: {
          loggedOn,
          quantity: q,
          ...(crew.trim() ? { crew: crew.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
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
    <Card title={`Log quantity for ${name}`}>
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
            label={`Quantity installed (${uom})`}
            inputMode="decimal"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="form-row">
          <TextField label="Crew" value={crew} onChange={(e) => setCrew(e.target.value)} />
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
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
              {formatLocalDate(e.loggedOn)}: <span className="u-mono">{e.quantity}</span> {uom}
              {e.crew ? ` · ${e.crew}` : ''}
              {e.note ? ` – ${e.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
