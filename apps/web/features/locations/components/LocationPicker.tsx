'use client';

import { Button, NovaSuggestion, Select } from '@archova/ui';
import { useLocationSuggestions, useLocations } from '../hooks/useLocations';
import { flatten } from '../lib/tree';

/**
 * Pick where a record is from the project's location tree. When the person has typed a title or description,
 * Nova offers the places those words name; nothing is chosen until they press "Use".
 */
export function LocationPicker({
  projectId,
  value,
  onChange,
  label = 'Location',
  required,
  error,
  suggestFrom,
  placeholder = 'Choose a location',
}: {
  projectId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  error?: string;
  /** Words Nova reads to guess the place (title, description). */
  suggestFrom?: string;
  placeholder?: string;
}) {
  const locations = useLocations(projectId);
  const suggestions = useLocationSuggestions(projectId, value ? '' : (suggestFrom ?? ''));
  const rows = flatten(locations.data ?? []);
  const offered = (suggestions.data ?? []).filter((s) => s.locationId !== value);
  const empty = !locations.isPending && rows.length === 0;
  return (
    <div className="stack">
      <Select
        label={label}
        value={value ?? ''}
        placeholder={locations.isPending ? 'Loading locations…' : placeholder}
        required={required}
        error={error ?? (locations.error ? "We couldn't load the locations." : undefined)}
        hint={empty ? 'This project has no locations yet. Add them under Locations.' : undefined}
        disabled={locations.isPending || empty}
        options={rows.map(({ location }) => ({ value: location.id, label: location.path }))}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {!value && offered.length > 0 ? (
        <NovaSuggestion title="Is it here?">
          <ul className="u-m-0 stack">
            {offered.map((s) => (
              <li key={s.locationId}>
                <span>{s.path}</span> <span className="u-muted">({s.reason})</span>{' '}
                <Button size="sm" variant="secondary" onClick={() => onChange(s.locationId)}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </NovaSuggestion>
      ) : null}
    </div>
  );
}
