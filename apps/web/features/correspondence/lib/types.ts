import type { components } from '@archova/contracts/openapi';
import type { StatusTone } from '@archova/ui';

export type CorrespondenceItem = components['schemas']['CorrespondenceItem'];
export type CorrespondenceDetail = components['schemas']['CorrespondenceDetail'];
export type CorrespondenceResponse = components['schemas']['CorrespondenceResponse'];
export type CorrespondenceStatus = components['schemas']['CorrespondenceStatus'];
export type CorrespondenceType = components['schemas']['CorrespondenceType'];
export type CorrespondenceTemplate = components['schemas']['CorrespondenceTemplate'];

export const CORRESPONDENCE_STATUSES: readonly CorrespondenceStatus[] = [
  'draft',
  'sent',
  'responded',
  'closed',
  'void',
];

export const STATUS_LABELS: Record<CorrespondenceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  responded: 'Responded',
  closed: 'Closed',
  void: 'Void',
};

export const STATUS_TONES: Record<CorrespondenceStatus, StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  responded: 'success',
  closed: 'neutral',
  void: 'neutral',
};

export interface CorrespondenceFilters {
  status?: CorrespondenceStatus | undefined;
  typeId?: string | undefined;
  awaitingResponse?: boolean | undefined;
  q?: string | undefined;
}

export interface CorrespondenceInput {
  typeId: string;
  subject: string;
  body: string;
  toCompanyIds: string[];
  eventDate: string;
}
