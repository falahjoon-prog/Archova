'use client';

import { Button, Select, TextField, Textarea } from '@archova/ui';
import { Plus } from '@archova/ui/icons';
import { RISK_LABELS, RISK_LEVELS, type Hazard, type RiskLevel } from '../lib/types';

export const blankHazard = (): Hazard => ({
  hazard: '',
  riskBefore: 'medium',
  controls: '',
  riskAfter: 'low',
});

const riskOptions = RISK_LEVELS.map((r) => ({ value: r, label: RISK_LABELS[r] }));

/** What the crew will do about each hazard: the hazard, how risky it is, the controls, and the risk left over. */
export function HazardEditor({
  hazards,
  onChange,
}: {
  hazards: Hazard[];
  onChange: (next: Hazard[]) => void;
}) {
  const set = (i: number, patch: Partial<Hazard>) =>
    onChange(hazards.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <div className="stack">
      {hazards.map((h, i) => (
        <fieldset
          key={i}
          className="stack"
          style={{
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            margin: 0,
            minWidth: 0,
          }}
        >
          <legend>Hazard {i + 1}</legend>
          <TextField
            label="What could go wrong"
            value={h.hazard}
            onChange={(e) => set(i, { hazard: e.target.value })}
          />
          <Select
            label="Risk before controls"
            value={h.riskBefore}
            options={riskOptions}
            onChange={(e) => set(i, { riskBefore: e.target.value as RiskLevel })}
          />
          <Textarea
            label="How we will control it"
            value={h.controls}
            onChange={(e) => set(i, { controls: e.target.value })}
          />
          <Select
            label="Risk after controls"
            value={h.riskAfter}
            options={riskOptions}
            onChange={(e) => set(i, { riskAfter: e.target.value as RiskLevel })}
          />
          <div>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => onChange(hazards.filter((_, j) => j !== i))}
            >
              Remove hazard {i + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onChange([...hazards, blankHazard()])}>
          <Plus size={16} aria-hidden="true" /> Add a hazard
        </Button>
      </div>
    </div>
  );
}
