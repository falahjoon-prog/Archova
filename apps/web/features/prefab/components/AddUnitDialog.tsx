'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, Select, Textarea, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { CreateUnit, DatePlan, UnitKind } from '../data/api';
import type { usePrefabMutations } from '../hooks/usePrefab';
import { KIND_LABELS, fmtDate } from '../lib/units';

const KINDS = Object.entries(KIND_LABELS) as [UnitKind, string][];

export interface DeliveryOption {
  id: string;
  label: string;
}

/** Add a unit. Nova can work back from the install date to when it must ship and when the factory must start. */
export function AddUnitDialog({
  open,
  onClose,
  deliveries,
  m,
}: {
  open: boolean;
  onClose: () => void;
  deliveries: readonly DeliveryOption[];
  m: ReturnType<typeof usePrefabMutations>;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<UnitKind>('bathroom_pod');
  const [factory, setFactory] = useState('');
  const [location, setLocation] = useState('');
  const [sequence, setSequence] = useState('');
  const [fabStart, setFabStart] = useState('');
  const [fabDue, setFabDue] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [installDate, setInstallDate] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DatePlan | null>(null);

  function reset() {
    setCode('');
    setName('');
    setFactory('');
    setLocation('');
    setSequence('');
    setFabStart('');
    setFabDue('');
    setShipDate('');
    setInstallDate('');
    setDeliveryId('');
    setNotes('');
    setPlan(null);
    setError(null);
  }

  function suggest() {
    setError(null);
    if (!installDate)
      return setError('Enter the install date first, then Nova can plan back from it.');
    m.planDates.mutate(
      { installDate, kind },
      {
        onSuccess: (p) => {
          setPlan(p);
          setFabStart(p.fabStart);
          setFabDue(p.fabDue);
          setShipDate(p.shipDate);
        },
      },
    );
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const seq = sequence.trim() === '' ? undefined : Number(sequence);
    if (!code.trim()) return setError('Enter a unit code, for example BP-L3-01.');
    if (!name.trim()) return setError('Enter a name.');
    if (seq !== undefined && (!Number.isInteger(seq) || seq < 1))
      return setError('The install sequence is a whole number from 1.');
    if (fabStart && fabDue && fabDue < fabStart)
      return setError('Fabrication must finish on or after the day it starts.');
    const body: CreateUnit = {
      code: code.trim(),
      name: name.trim(),
      kind,
      ...(factory.trim() ? { factoryName: factory.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(seq !== undefined ? { installSequence: seq } : {}),
      ...(fabStart ? { fabStart } : {}),
      ...(fabDue ? { fabDue } : {}),
      ...(shipDate ? { shipDate } : {}),
      ...(installDate ? { installDate } : {}),
      ...(deliveryId ? { deliveryId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    m.create.mutate(body, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a prefab unit"
      description="A pod, panel or module built off site. It starts with the standard QA checklist for its kind."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-unit-form" loading={m.create.isPending}>
            Add unit
          </Button>
        </>
      }
    >
      <form id="add-unit-form" className="stack" onSubmit={save} noValidate>
        <div className="form-row">
          <TextField
            label="Unit code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as UnitKind)}
            options={KINDS.map(([value, label]) => ({ value, label }))}
          />
        </div>
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-row">
          <TextField label="Factory" value={factory} onChange={(e) => setFactory(e.target.value)} />
          <TextField
            label="Location on site"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            hint="For example Level 3, grid B4."
          />
          <TextField
            label="Install sequence"
            inputMode="numeric"
            value={sequence}
            onChange={(e) => setSequence(e.target.value)}
            hint="1 goes in first."
          />
        </div>
        <div className="form-row">
          <TextField
            label="Install date"
            type="date"
            value={installDate}
            onChange={(e) => setInstallDate(e.target.value)}
          />
          <div className="pfb-plan">
            <Button variant="secondary" onClick={suggest} loading={m.planDates.isPending}>
              <NovaIcon size={14} /> Plan dates with Nova
            </Button>
          </div>
        </div>
        {plan ? (
          <Alert tone="info">
            Working back from {fmtDate(plan.installDate)}: delivered {fmtDate(plan.deliveryDate)},
            ship {fmtDate(plan.shipDate)}, finish {fmtDate(plan.fabDue)}, start{' '}
            {fmtDate(plan.fabStart)} ({plan.fabDays} working days in the factory, {plan.transitDays}{' '}
            in transit, {plan.bufferDays} spare on site). Edit any date below.
          </Alert>
        ) : null}
        <div className="form-row">
          <TextField
            label="Fabrication starts"
            type="date"
            value={fabStart}
            onChange={(e) => setFabStart(e.target.value)}
          />
          <TextField
            label="Fabrication due"
            type="date"
            value={fabDue}
            onChange={(e) => setFabDue(e.target.value)}
          />
          <TextField
            label="Ships"
            type="date"
            value={shipDate}
            onChange={(e) => setShipDate(e.target.value)}
          />
        </div>
        {deliveries.length > 0 ? (
          <Select
            label="Site delivery"
            value={deliveryId}
            onChange={(e) => setDeliveryId(e.target.value)}
            placeholder="Not booked yet"
            options={deliveries.map((d) => ({ value: d.id, label: d.label }))}
          />
        ) : null}
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.create.error ?? m.planDates.error} title="We couldn't do that" />
      </form>
    </Dialog>
  );
}
