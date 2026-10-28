'use client';

import type { MouseEvent } from 'react';
import { Select, TextField } from '@archova/ui';
import { useSheetPicker } from '@/features/drawings';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Defect } from '../lib/types';

type Pin = NonNullable<Defect['drawing']>;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const percent = (n: number) => Math.round(n * 1000) / 10;

/**
 * Where a defect is: a drawing's current revision and a spot on it (the server stores a pin, not a room). Click the
 * sheet outline to place it, or type the position; the exact spot can be moved later in the drawing viewer.
 */
export function PinPlacer({
  value,
  error,
  onChange,
}: {
  value: Pin | null;
  error?: string | undefined;
  onChange: (pin: Pin | null) => void;
}) {
  const project = useCurrentProject();
  const sheets = useSheetPicker(project.projectId);

  const choose = (sheetId: string) => {
    const s = sheets.options.find((o) => o.sheetId === sheetId);
    onChange(
      s
        ? {
            sheetId: s.sheetId,
            revisionId: s.revisionId,
            label: s.label,
            x: value?.x ?? 0.5,
            y: value?.y ?? 0.5,
          }
        : null,
    );
  };
  const place = (e: MouseEvent<HTMLDivElement>) => {
    if (!value) return;
    const box = e.currentTarget.getBoundingClientRect();
    onChange({
      ...value,
      x: clamp((e.clientX - box.left) / box.width),
      y: clamp((e.clientY - box.top) / box.height),
    });
  };
  const move = (axis: 'x' | 'y', text: string) => {
    if (!value || text.trim() === '' || Number.isNaN(Number(text))) return;
    onChange({ ...value, [axis]: clamp(Number(text) / 100) });
  };

  return (
    <div className="stack pin-placer">
      <Select
        label="Drawing"
        value={value?.sheetId ?? ''}
        placeholder={sheets.isPending ? 'Loading drawings…' : 'Choose a drawing'}
        error={error}
        required
        options={sheets.options.map((s) => ({
          value: s.sheetId,
          label: `${s.label} · ${s.title}`,
        }))}
        onChange={(e) => choose(e.target.value)}
      />
      {value ? (
        <>
          <div className="form-row">
            <TextField
              label="Across the sheet (%)"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={String(percent(value.x))}
              onChange={(e) => move('x', e.target.value)}
            />
            <TextField
              label="Down the sheet (%)"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={String(percent(value.y))}
              onChange={(e) => move('y', e.target.value)}
            />
          </div>
          <div
            className="pin-placer__sheet"
            data-testid="pin-sheet"
            aria-hidden="true"
            onClick={place}
          >
            <span
              className="pin-placer__pin"
              style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
            />
          </div>
          <p className="u-caption u-muted u-m-0">
            Click the outline to place the pin, or type the position.
          </p>
        </>
      ) : null}
    </div>
  );
}
