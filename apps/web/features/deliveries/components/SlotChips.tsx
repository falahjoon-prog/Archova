'use client';

import { Button } from '@archova/ui';
import type { DeliverySlot, Resource } from '../data/api';
import { dayOf, fmtDay, fmtWindow } from '../lib/board';

/** Free windows Nova found; choosing one hands it back to the form or the reschedule. */
export function SlotChips({
  slots,
  resources,
  tz,
  onPick,
  disabled,
}: {
  slots: readonly DeliverySlot[];
  resources: readonly Resource[];
  tz: string;
  onPick: (s: DeliverySlot) => void;
  disabled?: boolean;
}) {
  const name = (id: string | null) => resources.find((r) => r.id === id)?.name;
  if (slots.length === 0)
    return (
      <p className="u-m-0 u-caption">
        Nothing is free in site hours over the next week for those needs. Try a shorter window or
        add a dock or crane.
      </p>
    );
  return (
    <ul className="dlv-chips" aria-label="Free windows">
      {slots.map((s) => (
        <li key={`${s.start}-${s.zoneId}-${s.liftResourceId ?? ''}`}>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onPick(s)}>
            {fmtDay(dayOf(s.start, tz))},{' '}
            {fmtWindow({ windowStart: s.start, windowEnd: s.end }, tz)} · {name(s.zoneId) ?? 'Dock'}
            {s.liftResourceId ? ` + ${name(s.liftResourceId) ?? 'lift'}` : ''}
          </Button>
        </li>
      ))}
    </ul>
  );
}
