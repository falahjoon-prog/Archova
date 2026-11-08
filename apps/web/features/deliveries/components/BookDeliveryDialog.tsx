'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, Select, Textarea, TextField } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { CreateDelivery, DeliverySlot, Resource } from '../data/api';
import { dayOf, instantOf, isDock, timeInputValue } from '../lib/board';
import type { useDeliveryMutations } from '../hooks/useDeliveries';
import { SlotChips } from './SlotChips';

export interface PurchaseOrderOption {
  id: string;
  label: string;
}

/** Book a delivery. Nova can find a free window at a dock, and a crane if one is needed, before anything is saved. */
export function BookDeliveryDialog({
  open,
  onClose,
  resources,
  purchaseOrders,
  day,
  tz,
  m,
}: {
  open: boolean;
  onClose: () => void;
  resources: readonly Resource[];
  purchaseOrders: readonly PurchaseOrderOption[];
  day: string;
  tz: string;
  m: ReturnType<typeof useDeliveryMutations>;
}) {
  const docks = useMemo(() => resources.filter((r) => r.active && isDock(r.kind)), [resources]);
  const lifts = useMemo(() => resources.filter((r) => r.active && !isDock(r.kind)), [resources]);
  const [title, setTitle] = useState('');
  const [supplier, setSupplier] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [items, setItems] = useState('');
  const [date, setDate] = useState(day);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [zoneId, setZoneId] = useState('');
  const [liftId, setLiftId] = useState('');
  const [needsLift, setNeedsLift] = useState(false);
  const [poId, setPoId] = useState('');
  const [access, setAccess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<DeliverySlot[] | null>(null);

  const minutes = () => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const d = (eh! - sh!) * 60 + (em! - sm!);
    return d >= 15 && d <= 480 ? d : 60;
  };

  function findSlot() {
    setError(null);
    m.suggest.mutate(
      {
        durationMinutes: minutes(),
        fromDate: date,
        needsLift: needsLift || !!liftId,
        ...(zoneId ? { zoneId } : {}),
        ...(liftId ? { liftResourceId: liftId } : {}),
      },
      { onSuccess: setSlots },
    );
  }
  function pick(s: DeliverySlot) {
    setDate(dayOf(s.start, tz));
    setStart(timeInputValue(s.start, tz));
    setEnd(timeInputValue(s.end, tz));
    setZoneId(s.zoneId);
    if (s.liftResourceId) {
      setLiftId(s.liftResourceId);
      setNeedsLift(true);
    }
    setSlots(null);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Say what is being delivered.');
    if (!supplier.trim()) return setError('Enter the supplier.');
    if (end <= start) return setError('The window must end after it starts.');
    const body: CreateDelivery = {
      title: title.trim(),
      supplierName: supplier.trim(),
      windowStart: instantOf(date, start, tz),
      windowEnd: instantOf(date, end, tz),
      needsLift: needsLift || !!liftId,
      ...(contact.trim() ? { supplierContact: contact.trim() } : {}),
      ...(email.trim() ? { supplierEmail: email.trim() } : {}),
      ...(items.trim()
        ? {
            items: items
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((description) => ({ description })),
          }
        : {}),
      ...(zoneId ? { zoneId } : {}),
      ...(liftId ? { liftResourceId: liftId } : {}),
      ...(poId ? { commitmentId: poId } : {}),
      ...(access.trim() ? { accessNotes: access.trim() } : {}),
    };
    m.create.mutate(body, {
      onSuccess: () => {
        setTitle('');
        setItems('');
        setSlots(null);
        onClose();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Book a delivery"
      description="Pick a window, then the dock and crane. Nova can find a free one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="book-delivery" loading={m.create.isPending}>
            Book delivery
          </Button>
        </>
      }
    >
      <form id="book-delivery" className="stack" onSubmit={save} noValidate>
        <TextField
          label="What is arriving"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="form-row">
          <TextField
            label="Supplier"
            required
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
          <TextField label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          <TextField
            label="Supplier email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Textarea
          label="Items, one per line"
          rows={3}
          value={items}
          onChange={(e) => setItems(e.target.value)}
        />
        <div className="form-row">
          <TextField
            label="Date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="From"
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label="To"
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="form-row">
          <Select
            label="Unloading at"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            options={[
              { value: '', label: 'Not decided' },
              ...docks.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            label="Crane, hoist or lift"
            value={liftId}
            onChange={(e) => {
              setLiftId(e.target.value);
              if (e.target.value) setNeedsLift(true);
            }}
            options={[
              { value: '', label: needsLift ? 'Needed, not booked' : 'None' },
              ...lifts.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            label="Purchase order"
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            options={[
              { value: '', label: 'None' },
              ...purchaseOrders.map((p) => ({ value: p.id, label: p.label })),
            ]}
          />
        </div>
        <label className="dlv-check">
          <input
            type="checkbox"
            checked={needsLift || !!liftId}
            disabled={!!liftId}
            onChange={(e) => setNeedsLift(e.target.checked)}
          />
          Needs a crane, hoist or lift to unload
        </label>
        <TextField
          label="Site access notes"
          value={access}
          onChange={(e) => setAccess(e.target.value)}
          hint="Gate, traffic control, vehicle size."
        />
        <div className="ac-nova">
          <p className="ac-nova__label">
            <NovaIcon size={14} /> Nova
          </p>
          <p className="u-m-0 u-caption">
            Finds a window inside site hours that avoids other deliveries.
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              loading={m.suggest.isPending}
              onClick={findSlot}
            >
              Find a free window
            </Button>
          </div>
          {slots ? <SlotChips slots={slots} resources={resources} tz={tz} onPick={pick} /> : null}
          <ErrorAlert error={m.suggest.error} title="We couldn't look for a window" />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.create.error} title="We couldn't book this delivery" />
      </form>
    </Dialog>
  );
}
