'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  buttonClassName,
  Dialog,
  Select,
  SkeletonRows,
  StatusPill,
  Textarea,
  TextField,
} from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import type { DeliveryNotice, DeliverySlot, Resource } from '../data/api';
import { useDeliveryDetail, type useDeliveryMutations } from '../hooks/useDeliveries';
import { dayOf, fmtDay, fmtWindow, instantOf, STATUS_LABELS, STATUS_TONES } from '../lib/board';
import { SlotChips } from './SlotChips';

type Panel = 'reschedule' | 'notice' | null;
type NoticeKind = 'confirm' | 'late' | 'reschedule' | 'cancel';
const NOTICE_LABELS: Record<NoticeKind, string> = {
  confirm: 'Confirm the booking',
  late: 'Chase a late truck',
  reschedule: 'Ask for a new time',
  cancel: 'Cancel the delivery',
};
const EVENT_LABELS: Record<string, string> = {
  created: 'Booked',
  updated: 'Details changed',
  rescheduled: 'Moved to a new window',
  arrived: 'Truck arrived',
  unloaded: 'Unloaded',
  delayed: 'Marked delayed',
  missed: 'Marked missed',
  cancelled: 'Cancelled',
  notice_drafted: 'Note to supplier drafted',
};

/**
 * One delivery: its plan, the gate check-in for site staff, and, for coordinators, moving it and writing to the
 * supplier. Nova proposes the new slot and drafts the note; a person reviews and sends it.
 */
export function DeliveryDialog({
  deliveryId,
  initialPanel,
  onClose,
  resources,
  tz,
  canManage,
  canCheckIn,
  senderName,
  m,
  projectId,
}: {
  deliveryId: string | null;
  initialPanel: Panel;
  onClose: () => void;
  resources: readonly Resource[];
  tz: string;
  canManage: boolean;
  canCheckIn: boolean;
  senderName: string;
  m: ReturnType<typeof useDeliveryMutations>;
  projectId: string;
}) {
  const detail = useDeliveryDetail(projectId, deliveryId);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [slots, setSlots] = useState<DeliverySlot[] | null>(null);
  const [reason, setReason] = useState('');
  const [noticeKind, setNoticeKind] = useState<NoticeKind>('late');
  const [notice, setNotice] = useState<DeliveryNotice | null>(null);
  const [body, setBody] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPanel(initialPanel);
    setSlots(null);
    setNotice(null);
    setReason('');
    setCopied(false);
    // Opening the reschedule panel from a flag looks for a slot straight away.
  }, [deliveryId, initialPanel]);

  const d = detail.data?.delivery;
  const name = (id: string | null) => resources.find((r) => r.id === id)?.name ?? null;
  const live = d && (d.status === 'scheduled' || d.status === 'delayed' || d.status === 'arrived');
  const minutes = d
    ? Math.max(15, Math.round((Date.parse(d.windowEnd) - Date.parse(d.windowStart)) / 60_000))
    : 60;

  function findSlots() {
    if (!d) return;
    m.suggest.mutate(
      {
        durationMinutes: Math.min(minutes, 480),
        needsLift: d.needsLift,
        ignoreDeliveryId: d.id,
        ...(d.zoneId ? { zoneId: d.zoneId } : {}),
        ...(d.liftResourceId ? { liftResourceId: d.liftResourceId } : {}),
      },
      { onSuccess: setSlots },
    );
  }
  function moveTo(s: DeliverySlot) {
    if (!d) return;
    m.change.mutate(
      {
        deliveryId: d.id,
        body: {
          action: 'reschedule',
          windowStart: s.start,
          windowEnd: s.end,
          zoneId: s.zoneId,
          ...(s.liftResourceId ? { liftResourceId: s.liftResourceId } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      },
      { onSuccess: () => setPanel(null) },
    );
  }
  function moveManually() {
    if (!d || !date || !start || !end) return;
    moveTo({
      start: instantOf(date, start, tz),
      end: instantOf(date, end, tz),
      zoneId: d.zoneId ?? '',
      liftResourceId: null,
      liftEnd: null,
    } as DeliverySlot);
  }
  function draft() {
    if (!d) return;
    m.notice.mutate(
      {
        deliveryId: d.id,
        body: { kind: noticeKind, senderName, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      },
      {
        onSuccess: (n) => {
          setNotice(n);
          setBody(n.body);
          setCopied(false);
        },
      },
    );
  }
  async function copy() {
    if (!notice) return;
    try {
      await navigator.clipboard.writeText(`${notice.subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const act = (action: 'delay' | 'miss' | 'cancel') =>
    d &&
    m.change.mutate({
      deliveryId: d.id,
      body: { action, ...(reason.trim() ? { reason: reason.trim() } : {}) },
    });

  const busy = m.change.isPending || m.checkIn.isPending;
  return (
    <Dialog
      open={deliveryId !== null}
      onClose={onClose}
      title={d ? `Delivery #${d.number}: ${d.title}` : 'Delivery'}
      description={
        d
          ? `${d.supplierName} · ${fmtDay(dayOf(d.windowStart, tz))}, ${fmtWindow(d, tz)}`
          : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isPending ? <SkeletonRows label="Loading delivery…" /> : null}
      <ErrorAlert error={detail.error} title="We couldn't load this delivery" />
      {d ? (
        <div className="stack">
          <p className="u-m-0">
            <StatusPill tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</StatusPill>
            {d.statusReason ? <span className="u-caption"> {d.statusReason}</span> : null}
          </p>
          <dl className="dlv-facts">
            <dt>Unloading at</dt>
            <dd>{name(d.zoneId) ?? 'Not decided'}</dd>
            <dt>Crane or hoist</dt>
            <dd>
              {name(d.liftResourceId) ?? (d.needsLift ? 'Needed, not booked' : 'Not needed')}
              {d.liftStart && d.liftEnd
                ? ` (${fmtWindow({ windowStart: d.liftStart, windowEnd: d.liftEnd }, tz)})`
                : ''}
            </dd>
            {d.commitmentLabel ? (
              <>
                <dt>Purchase order</dt>
                <dd>{d.commitmentLabel}</dd>
              </>
            ) : null}
            {d.supplierContact || d.supplierPhone || d.supplierEmail ? (
              <>
                <dt>Supplier contact</dt>
                <dd>
                  {[d.supplierContact, d.supplierPhone, d.supplierEmail]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </>
            ) : null}
            {d.vehicle ? (
              <>
                <dt>Vehicle</dt>
                <dd>{d.vehicle}</dd>
              </>
            ) : null}
            {d.accessNotes ? (
              <>
                <dt>Site access</dt>
                <dd>{d.accessNotes}</dd>
              </>
            ) : null}
            {d.arrivedAt ? (
              <>
                <dt>Arrived</dt>
                <dd>{formatInstant(d.arrivedAt, tz)}</dd>
              </>
            ) : null}
            {d.unloadedAt ? (
              <>
                <dt>Unloaded</dt>
                <dd>{formatInstant(d.unloadedAt, tz)}</dd>
              </>
            ) : null}
          </dl>
          {d.items.length > 0 ? (
            <ul className="stack-sm">
              {d.items.map((i, n) => (
                <li key={n}>{[i.quantity, i.unit, i.description].filter(Boolean).join(' ')}</li>
              ))}
            </ul>
          ) : null}

          {canCheckIn &&
          (d.status === 'scheduled' || d.status === 'delayed' || d.status === 'arrived') ? (
            <div className="dlv-checkin">
              {d.status === 'arrived' ? (
                <Button
                  loading={m.checkIn.isPending}
                  onClick={() => m.checkIn.mutate({ deliveryId: d.id, event: 'unloaded' })}
                >
                  Mark unloaded
                </Button>
              ) : (
                <Button
                  loading={m.checkIn.isPending}
                  onClick={() => m.checkIn.mutate({ deliveryId: d.id, event: 'arrived' })}
                >
                  Truck has arrived
                </Button>
              )}
            </div>
          ) : null}
          <ErrorAlert error={m.checkIn.error} title="We couldn't log that" />

          {canManage && (live || d.status === 'missed') ? (
            <div className="stack">
              <div className="row-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPanel('reschedule');
                    findSlots();
                  }}
                >
                  Reschedule
                </Button>
                {d.status === 'scheduled' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || !reason.trim()}
                    onClick={() => act('delay')}
                  >
                    Mark delayed
                  </Button>
                ) : null}
                {d.status !== 'arrived' && d.status !== 'missed' ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => act('miss')}>
                    Mark missed
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !reason.trim()}
                  onClick={() => act('cancel')}
                >
                  Cancel delivery
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setPanel('notice')}>
                  Note to supplier
                </Button>
              </div>
              <TextField
                label="Reason"
                hint="Needed to delay or cancel; kept in the history."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <ErrorAlert error={m.change.error} title="We couldn't change this delivery" />

              {panel === 'reschedule' ? (
                <div className="ac-nova">
                  <p className="ac-nova__label">
                    <NovaIcon size={14} /> Nova
                  </p>
                  <p className="u-m-0 u-caption">
                    Free windows at {name(d.zoneId) ?? 'a dock'}
                    {d.needsLift ? ' with a crane' : ''}, inside site hours. Choose one to move the
                    delivery.
                  </p>
                  {m.suggest.isPending ? (
                    <SkeletonRows label="Looking for free windows…" />
                  ) : slots ? (
                    <SlotChips
                      slots={slots}
                      resources={resources}
                      tz={tz}
                      onPick={moveTo}
                      disabled={busy}
                    />
                  ) : (
                    <Button size="sm" variant="secondary" onClick={findSlots}>
                      Find free windows
                    </Button>
                  )}
                  <ErrorAlert error={m.suggest.error} title="We couldn't look for a window" />
                  <div className="form-row">
                    <TextField
                      label="Or pick a date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    <TextField
                      label="From"
                      type="time"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                    <TextField
                      label="To"
                      type="time"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </div>
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !date || !start || !end}
                      onClick={moveManually}
                    >
                      Move to that time
                    </Button>
                  </div>
                </div>
              ) : null}

              {panel === 'notice' ? (
                <div className="ac-nova">
                  <p className="ac-nova__label">
                    <NovaIcon size={14} /> Nova
                  </p>
                  <p className="u-m-0 u-caption">
                    Nova writes the note. You read, edit and send it; nothing goes out from here.
                  </p>
                  <Select
                    label="What is it for"
                    value={noticeKind}
                    onChange={(e) => {
                      setNoticeKind(e.target.value as NoticeKind);
                      setNotice(null);
                    }}
                    options={Object.entries(NOTICE_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={m.notice.isPending}
                      onClick={draft}
                    >
                      Draft the note
                    </Button>
                  </div>
                  <ErrorAlert error={m.notice.error} title="We couldn't draft the note" />
                  {notice ? (
                    <div className="stack">
                      <TextField label="Subject" value={notice.subject} readOnly />
                      <Textarea
                        label="Message"
                        rows={9}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                      />
                      {!notice.to ? (
                        <Alert tone="info">
                          There is no email on file for this supplier. Copy the note into your own
                          email.
                        </Alert>
                      ) : null}
                      <div className="row-actions">
                        <Button size="sm" variant="secondary" onClick={copy}>
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                        {notice.to ? (
                          <a
                            className={buttonClassName('secondary', 'ac-button--sm')}
                            href={`mailto:${notice.to}?subject=${encodeURIComponent(notice.subject)}&body=${encodeURIComponent(body)}`}
                          >
                            Open in email
                          </a>
                        ) : null}
                        {notice.proposed ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => moveTo(notice.proposed!)}
                          >
                            Move to {fmtDay(dayOf(notice.proposed.start, tz))},{' '}
                            {fmtWindow(
                              {
                                windowStart: notice.proposed.start,
                                windowEnd: notice.proposed.end,
                              },
                              tz,
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <h3 className="u-m-0">History</h3>
          <ul className="stack-sm">
            {detail.data!.events.map((e) => (
              <li key={e.id}>
                <span className="u-caption">{formatInstant(e.at, tz)}</span>{' '}
                {EVENT_LABELS[e.kind] ?? e.kind}
                {e.detail && e.kind !== 'notice_drafted' && e.kind !== 'rescheduled'
                  ? `: ${e.detail}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}
