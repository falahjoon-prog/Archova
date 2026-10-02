'use client';

import { useState } from 'react';
import { STANDARD_SCALES, formatScale } from '@archova/markup';
import { Alert, Button, Select } from '@archova/ui';
import type { ViewerSheetContext } from '@/shared/drawing-viewer/extension';
import { formatInstant } from '@/shared/lib/format';

/**
 * Scale first (F1.3a step 2, EST-AC8): detected-but-unconfirmed shows the scale with Confirm, another standard
 * scale, or Calibrate; no scale prompts calibration; a title-block/dimension conflict blocks measuring until set.
 */
export function ScaleSection({
  sheet,
  timezone,
  onCalibrate,
  calibrating,
}: {
  sheet: ViewerSheetContext;
  timezone: string;
  onCalibrate: () => void;
  calibrating: boolean;
}) {
  const g = sheet.geometry;
  const [choice, setChoice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (scale: string) => {
    setPending(true);
    setError(null);
    try {
      await sheet.confirmScale(scale);
    } catch {
      setError("We couldn't save the scale. Try again.");
    } finally {
      setPending(false);
    }
  };

  if (!g)
    return (
      <Alert tone="info">
        This sheet is still being read. Measuring opens once its geometry is ready.
      </Alert>
    );

  const picker = (
    <div className="scale-picker">
      <Select
        label="Choose a scale"
        placeholder="Standard scales"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        options={STANDARD_SCALES.map((n) => ({ value: formatScale(n), label: formatScale(n) }))}
      />
      <Button
        variant="secondary"
        disabled={!choice}
        loading={pending}
        onClick={() => confirm(choice)}
      >
        Use this scale
      </Button>
    </div>
  );
  const calibrate = (
    <Button variant="secondary" aria-pressed={calibrating} onClick={onCalibrate}>
      {calibrating ? 'Click two points on a known dimension' : 'Calibrate from a dimension'}
    </Button>
  );

  if (g.scaleConfirmed) {
    return (
      <div className="scale-ok">
        <p className="u-m-0">
          <strong>Scale {g.scaleConfirmed}</strong> confirmed
          {g.scaleConfirmedBy ? ` by ${g.scaleConfirmedBy}` : ''}
          {g.scaleConfirmedAt ? ` on ${formatInstant(g.scaleConfirmedAt, timezone)}` : ''}.
        </p>
        <details>
          <summary className="link">Change scale</summary>
          <div className="stack">
            {picker}
            {calibrate}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="stack">
      {g.scaleConflict ? (
        <Alert tone="danger" title="Set the scale before measuring">
          {g.scaleConflict}
        </Alert>
      ) : g.scaleDetected ? (
        <Alert
          tone="warning"
          title={`${g.scaleDetected} detected. Confirm?`}
          action={
            <Button loading={pending} onClick={() => confirm(g.scaleDetected!)}>
              Confirm {g.scaleDetected}
            </Button>
          }
        >
          Measuring opens once a person confirms the scale. We record who confirmed it and when.
        </Alert>
      ) : (
        <Alert tone="warning" title="No scale found on this sheet">
          Calibrate by drawing a line over a dimension you know, or choose a standard scale.
        </Alert>
      )}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {picker}
      {calibrate}
    </div>
  );
}
