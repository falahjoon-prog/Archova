export type SignalStatus = 'open' | 'confirmed' | 'dismissed';
export type SignalConfidence = 'low' | 'medium' | 'high';

export interface HazardSignal {
  id: string;
  fileId: string;
  category: string;
  categoryLabel: string;
  /** What the photo shows: an observation, never a finding. */
  observation: string;
  confidence: SignalConfidence;
  status: SignalStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface HazardScan {
  signals: HazardSignal[];
  photoUnclear: boolean;
  /** Signals Nova wrote as a judgment or a name, which were left out. */
  dropped: number;
  unsupportedNumbers: string[];
  disclaimer: string;
}

export interface HazardPattern {
  category: string;
  label: string;
  open: number;
  confirmed: number;
  dismissed: number;
  photos: number;
  isPattern: boolean;
  trend: 'rising' | 'steady' | 'falling';
}

export const STATUS_LABELS: Record<SignalStatus, string> = {
  open: 'To review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
};

export const CONFIDENCE_LABELS: Record<SignalConfidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export const TREND_LABELS: Record<HazardPattern['trend'], string> = {
  rising: 'Rising',
  steady: 'Steady',
  falling: 'Falling',
};

/** Nova reads PNG, JPEG and WebP up to 3 MB. */
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
