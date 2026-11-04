'use client';

import { useState } from 'react';
import { Button, Select } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { groupForEstimate } from '../data/estimates-api';
import { useEstimates, useEstimateMutations, useEstimatesApi } from '../hooks/useEstimates';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';

/**
 * Send accepted quantities to an estimate sheet (EST-US11): one line per tag and unit, linked to the measurements so
 * the quantity follows takeoff. Rates come later, from the cost library or typed on the sheet: nothing is priced here.
 */
export function SendToEstimateSection({
  accepted,
}: {
  /** Accepted measurements only; the caller never passes Nova's pending or rejected marks. */
  accepted: ReadonlyArray<{ id: string; label: string; unit: string }>;
}) {
  const { projectId } = useCurrentProject();
  const estimates = useEstimates();
  const apiClient = useEstimatesApi();
  const mutations = useEstimateMutations();
  const [estimateId, setEstimateId] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (previewDataOnly) return null;
  const drafts = (estimates.data ?? []).filter((e) => e.status === 'draft');

  const send = async () => {
    setError(null);
    setSent(null);
    try {
      // Read the sheet first so a measurement already on it is not added twice.
      const sheet = await apiClient.getEstimate(projectId, estimateId);
      const lines = groupForEstimate(accepted, sheet);
      if (lines.length > 0) await mutations.addLines.mutateAsync({ estimateId, lines });
      setSent(lines.length);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="stack">
      <Select
        label="Send to estimate"
        value={estimateId}
        placeholder={drafts.length ? 'Choose a draft estimate' : 'No draft estimates yet'}
        options={drafts.map((e) => ({ value: e.id, label: `${e.numberLabel} ${e.name}` }))}
        onChange={(ev) => setEstimateId(ev.target.value)}
      />
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!estimateId || accepted.length === 0 || mutations.addLines.isPending}
          onClick={send}
        >
          Send {accepted.length} accepted {accepted.length === 1 ? 'measurement' : 'measurements'}
        </Button>
      </div>
      {sent !== null ? (
        <p className="u-caption u-m-0" role="status">
          {sent === 0
            ? 'Those are already on the estimate.'
            : `Added ${sent} ${sent === 1 ? 'line' : 'lines'}, one per tag and unit. Price them on the sheet.`}
        </p>
      ) : null}
      <ErrorAlert error={error} title="We couldn't send the quantities" />
    </div>
  );
}
