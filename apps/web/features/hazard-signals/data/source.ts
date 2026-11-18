// Hazard signal data source, mirroring `POST .../ai/safety/photo-scans`, `GET .../ai/safety/hazard-signals`,
// `POST .../hazard-signals/{id}/review` and `GET .../hazard-patterns` (ai module, F35). Preview: an in-memory
// store; the scan reads the note's words because there is no model.

import { delay, mockId, nowIso, projectStores } from '@/shared/mocks/runtime';
import type { HazardPattern, HazardScan, HazardSignal, SignalStatus } from '../lib/types';

export const DISCLAIMER =
  'Nova flags what it can see in a photo for you to check. It is not a safety inspection and does not decide that a rule was broken.';

export interface HazardSignalSource {
  scan(projectId: string, input: { photo: File; note: string }): Promise<HazardScan>;
  list(projectId: string, status?: SignalStatus): Promise<HazardSignal[]>;
  review(
    projectId: string,
    id: string,
    input: { decision: 'confirmed' | 'dismissed'; note?: string },
  ): Promise<HazardSignal>;
  patterns(projectId: string, days: number): Promise<HazardPattern[]>;
}

const LABELS: Record<string, string> = {
  ppe: 'Protective equipment',
  edge_protection: 'Unprotected edge or opening',
  housekeeping: 'Housekeeping and walkways',
};

const stores = projectStores<HazardSignal[]>(() => []);
export const resetHazardPreview = () => stores.reset();

const RULES: Array<[RegExp, string, string]> = [
  [/hard hat|hi-?vis/i, 'ppe', 'The photo shows a worker whose hard hat appears not to be worn.'],
  [/edge|balustrade/i, 'edge_protection', 'The photo shows an open edge with no visible barrier.'],
  [/rubbish|debris|offcuts/i, 'housekeeping', 'The photo shows offcuts across the walkway.'],
];

export const hazardSignalsPreview: HazardSignalSource = {
  async scan(projectId, { photo, note }) {
    const store = stores.get(projectId);
    const made: HazardSignal[] = RULES.filter(([re]) => re.test(note)).map(
      ([, category, text]) => ({
        id: mockId('ahs'),
        fileId: mockId('fil'),
        category,
        categoryLabel: LABELS[category] ?? category,
        observation: text,
        confidence: 'medium',
        status: 'open',
        reviewNote: null,
        reviewedAt: null,
        createdAt: nowIso(),
      }),
    );
    void photo;
    store.unshift(...made);
    return delay({
      signals: made,
      photoUnclear: false,
      dropped: 0,
      unsupportedNumbers: [],
      disclaimer: DISCLAIMER,
    });
  },
  async list(projectId, status) {
    return delay(stores.get(projectId).filter((s) => !status || s.status === status));
  },
  async review(projectId, id, input) {
    const s = stores.get(projectId).find((x) => x.id === id);
    if (!s) throw new Error('Signal not found');
    s.status = input.decision;
    s.reviewNote = input.note?.trim() || null;
    s.reviewedAt = nowIso();
    return delay({ ...s });
  },
  async patterns(projectId) {
    const by = new Map<string, HazardSignal[]>();
    for (const s of stores.get(projectId)) by.set(s.category, [...(by.get(s.category) ?? []), s]);
    return delay(
      [...by].map(([category, rows]): HazardPattern => {
        const confirmed = rows.filter((r) => r.status === 'confirmed');
        const photos = new Set(confirmed.map((r) => r.fileId)).size;
        return {
          category,
          label: LABELS[category] ?? category,
          open: rows.filter((r) => r.status === 'open').length,
          confirmed: confirmed.length,
          dismissed: rows.filter((r) => r.status === 'dismissed').length,
          photos,
          isPattern: confirmed.length >= 3 && photos >= 2,
          trend: 'steady',
        };
      }),
    );
  },
};
