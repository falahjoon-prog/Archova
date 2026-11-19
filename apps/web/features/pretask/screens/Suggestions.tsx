'use client';

import { Button, Card, StatusPill } from '@archova/ui';
import { NovaIcon } from '@archova/ui/icons';
import { useHazardSuggestions } from '../hooks/usePretask';
import { REASON_LABELS, type Hazard, type Suggestion } from '../lib/types';

/** Nova's hazard suggestions. Nothing is added until a person chooses it. */
export function Suggestions({
  planId,
  swmsId,
  have,
  onAdd,
}: {
  planId?: string;
  swmsId?: string;
  have: Hazard[];
  onAdd: (s: Suggestion) => void;
}) {
  const q = useHazardSuggestions({
    ...(planId ? { planId } : {}),
    ...(swmsId ? { swmsId } : {}),
  });
  const taken = new Set(have.map((h) => h.hazard.trim().toLowerCase()));
  const rows = (q.data ?? []).filter((s) => !taken.has(s.hazard.trim().toLowerCase()));
  if (rows.length === 0) return null;
  return (
    <Card title="Nova suggests">
      <p
        className="u-m-0"
        style={{ marginBottom: 'var(--space-3)', color: 'var(--c-text-secondary)' }}
      >
        <NovaIcon size={14} aria-hidden="true" /> From rules over this project: hazards that keep
        coming up on recent plans, the linked SWMS and recent incidents. Add the ones that apply.
      </p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((s) => (
          <li
            key={`${s.reason}-${s.hazard}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ flex: '1 1 14rem', minWidth: 0 }}>
              <strong>{s.hazard}</strong>{' '}
              <StatusPill tone="neutral">{REASON_LABELS[s.reason]}</StatusPill>
              <br />
              <span style={{ color: 'var(--c-text-secondary)' }}>{s.because}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => onAdd(s)}>
              Add to plan
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
