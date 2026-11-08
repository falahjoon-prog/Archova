'use client';

import { useMemo, useState } from 'react';
import { can, type EffectivePermissions } from '@archova/domain/permissions';
import { suggestAccessPoint } from '@archova/domain';
import { Badge, Button, Card, Dialog, SkeletonRows, TextField, VisuallyHidden } from '@archova/ui';
import { MapPin, Phone, Plus, Sparkles } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { ProjectLocation } from '../data/locations';
import { LocationForm } from '../forms/LocationForm';
import { useLocationMutations, useProjectLocations } from '../hooks/useLocations';
import { KIND_LABELS } from '../lib/locations';

function LocationDetails({ l }: { l: ProjectLocation }) {
  return (
    <>
      {l.address ? <p className="location__address">{l.address}</p> : null}
      {l.accessNote ? <p className="location__note">{l.accessNote}</p> : null}
      {l.contactName || l.contactPhone ? (
        <p className="u-caption">
          {l.contactName ? `${l.contactName} ` : ''}
          {l.contactPhone ? (
            <a className="link" href={`tel:${l.contactPhone.replace(/[^\d+]/g, '')}`}>
              <Phone size={14} aria-hidden="true" /> {l.contactPhone}
            </a>
          ) : null}
        </p>
      ) : null}
      {l.directionsUrl ? (
        <p>
          <a
            className="link location__directions"
            href={l.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={16} aria-hidden="true" /> Get Directions
            <VisuallyHidden> to {l.name} (opens in a new tab)</VisuallyHidden>
          </a>
        </p>
      ) : null}
    </>
  );
}

/**
 * Project home: pinned points (site office, gates, laydown, parking, nearest hospital), each with a Get Directions
 * link and its access note. Nova, by rule and with no model call, offers the point that fits who is arriving.
 */
export function DirectionsCard({
  projectId,
  permissions,
}: {
  projectId: string;
  permissions: EffectivePermissions | undefined;
}) {
  const locations = useProjectLocations(projectId);
  const { remove } = useLocationMutations(projectId);
  const [form, setForm] = useState<{ location?: ProjectLocation } | null>(null);
  const [arrival, setArrival] = useState({ role: '', task: '' });
  const canEdit = permissions ? can(permissions, 'platform.projects.update') : false;
  const rows = useMemo(() => locations.data ?? [], [locations.data]);

  const suggestion = useMemo(
    () => (arrival.role.trim() || arrival.task.trim() ? suggestAccessPoint(rows, arrival) : null),
    [rows, arrival],
  );

  return (
    <Card
      title="Directions"
      actions={
        canEdit ? (
          <Button variant="secondary" onClick={() => setForm({})}>
            <Plus size={16} aria-hidden="true" /> Add location
          </Button>
        ) : undefined
      }
    >
      <ErrorAlert error={locations.error} title="We couldn't load the locations" />
      <ErrorAlert error={remove.error} title="We couldn't remove the location" />
      {locations.isPending ? <SkeletonRows rows={2} label="Loading locations…" /> : null}
      {locations.data && rows.length === 0 ? (
        <p className="u-muted">
          No locations yet.{' '}
          {canEdit
            ? 'Add the site office, gates, laydown, parking and the nearest hospital so anyone arriving knows where to go.'
            : 'A project admin can add them.'}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="stack">
          <section className="location-nova" aria-label="Which entrance?">
            <h3 className="panel-heading">
              <Sparkles size={16} aria-hidden="true" /> Who is arriving?
            </h3>
            <div className="form-row">
              <TextField
                label="Trade or role"
                placeholder="Concrete pump driver"
                value={arrival.role}
                maxLength={80}
                onChange={(e) => setArrival((a) => ({ ...a, role: e.target.value }))}
              />
              <TextField
                label="Today's task"
                placeholder="Level 3 slab pour"
                value={arrival.task}
                maxLength={120}
                onChange={(e) => setArrival((a) => ({ ...a, task: e.target.value }))}
              />
            </div>
            {suggestion ? (
              <div className="location-nova__result" role="status">
                <p>
                  <strong>Nova suggests {suggestion.point.name}.</strong>{' '}
                  <span className="u-muted">{suggestion.reason}</span>
                </p>
                <LocationDetails l={suggestion.point} />
              </div>
            ) : null}
          </section>
          <ul className="location-list">
            {rows.map((l) => (
              <li key={l.id} className="location">
                <div className="location__head">
                  <strong>{l.name}</strong>
                  <Badge>{KIND_LABELS[l.kind]}</Badge>
                  {l.isDefault ? <Badge>Default</Badge> : null}
                </div>
                <LocationDetails l={l} />
                {canEdit ? (
                  <div className="row-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setForm({ location: l })}
                      aria-label={`Edit ${l.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      loading={remove.isPending && remove.variables === l.id}
                      onClick={() => remove.mutate(l.id)}
                      aria-label={`Remove ${l.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.location ? 'Edit location' : 'Add location'}
      >
        {form ? (
          <LocationForm
            projectId={projectId}
            {...(form.location ? { location: form.location } : {})}
            onDone={() => setForm(null)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}
