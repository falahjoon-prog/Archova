'use client';

import { useState, type FormEvent } from 'react';
import { Button, Dialog, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { Factory } from '../data/api';
import type { usePrefabMutations } from '../hooks/usePrefab';

/** The factories this project builds units at. Units keep the name they were given, so removing one is safe. */
export function FactoriesDialog({
  open,
  onClose,
  factories,
  canWrite,
  m,
}: {
  open: boolean;
  onClose: () => void;
  factories: readonly Factory[];
  canWrite: boolean;
  m: ReturnType<typeof usePrefabMutations>;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [contact, setContact] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await m.addFactory.mutateAsync({
      name: name.trim(),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(contact.trim() ? { contact: contact.trim() } : {}),
    });
    setName('');
    setLocation('');
    setContact('');
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Factories"
      description="Pick from this list when you add a unit."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        {factories.length === 0 ? (
          <p className="u-m-0">No factories yet.</p>
        ) : (
          <ul className="pfb-factories">
            {factories.map((f) => (
              <li key={f.id} className="pfb-factory">
                <span>
                  <strong>{f.name}</strong>
                  {[f.location, f.contact].filter(Boolean).length > 0 ? (
                    <span className="u-muted">
                      {' '}
                      · {[f.location, f.contact].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </span>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={m.removeFactory.isPending && m.removeFactory.variables === f.id}
                    onClick={() => m.removeFactory.mutate(f.id)}
                  >
                    Remove {f.name}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <ErrorAlert error={m.removeFactory.error} title="We couldn't remove that factory" />
        {canWrite ? (
          <form className="stack" onSubmit={add} noValidate>
            <TextField
              label="Factory name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="form-row">
              <TextField
                label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <TextField
                label="Contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <ErrorAlert error={m.addFactory.error} title="We couldn't add that factory" />
            <div>
              <Button type="submit" loading={m.addFactory.isPending}>
                Add factory
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}
