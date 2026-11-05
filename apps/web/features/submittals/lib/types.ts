import type { components } from '@archova/contracts/openapi';
import type { StatusTone } from '@archova/ui';

export type Submittal = components['schemas']['Submittal'];
export type SubmittalDetail = components['schemas']['SubmittalDetail'];
export type SubmittalRevision = components['schemas']['SubmittalRevision'];
export type SubmittalStep = components['schemas']['SubmittalStep'];
export type SubmittalStatus = components['schemas']['SubmittalStatus'];
export type SubmittalType = components['schemas']['SubmittalType'];
export type ReviewAnswer = components['schemas']['SubmittalReviewAnswer'];

export const SUBMITTAL_STATUSES: readonly SubmittalStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'approved',
  'approved_as_noted',
  'revise_resubmit',
  'rejected',
  'closed',
];
export const SUBMITTAL_TYPES: readonly SubmittalType[] = [
  'shop_drawing',
  'product_data',
  'sample',
  'mock_up',
  'certificate',
  'other',
];

export const STATUS_LABELS: Record<SubmittalStatus, string> = {
  draft: 'Draft',
  submitted: 'With builder',
  in_review: 'In review',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
  closed: 'Closed',
};

export const STATUS_TONES: Record<SubmittalStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  in_review: 'info',
  approved: 'success',
  approved_as_noted: 'success',
  revise_resubmit: 'warning',
  rejected: 'danger',
  closed: 'neutral',
};

export const TYPE_LABELS: Record<SubmittalType, string> = {
  shop_drawing: 'Shop drawing',
  product_data: 'Product data',
  sample: 'Sample',
  mock_up: 'Mock-up',
  certificate: 'Certificate',
  other: 'Other',
};

export const ANSWER_LABELS: Record<ReviewAnswer, string> = {
  forwarded: 'Forward to consultants',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
};

export const STEP_LABELS: Record<SubmittalStep['response'], string> = {
  pending: 'Waiting',
  forwarded: 'Forwarded',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
  skipped: 'Not needed',
};

export interface SubmittalInput {
  title: string;
  numberLabel: string;
  type: SubmittalType;
  specSection: string;
  responsibleCompanyId: string;
  requiredOnSite: string;
  leadTimeDays: number;
  reviewDays: number;
}

export interface SubmittalFilters {
  status?: SubmittalStatus | undefined;
  type?: SubmittalType | undefined;
  q?: string | undefined;
  ballInCourt?: string | undefined;
}

/** SUB-AC7: the register as CSV, one row per item, opened in Excel or Sheets. */
export function registerCsv(
  rows: readonly Submittal[],
  names: { company(id: string | null): string; person(id: string | null): string },
): string {
  const cell = (v: string | number | null) => {
    const t = v === null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = [
    'Number',
    'Title',
    'Type',
    'Spec section',
    'Responsible',
    'Required on site',
    'Submit by',
    'Status',
    'Revision',
    'With',
  ];
  const lines = rows.map((r) =>
    [
      r.numberLabel,
      r.title,
      TYPE_LABELS[r.type],
      r.specSection,
      r.responsibleCompanyId ? names.company(r.responsibleCompanyId) : '',
      r.requiredOnSite,
      r.submitBy,
      STATUS_LABELS[r.status],
      r.currentRevision,
      r.ballInCourt.userIds[0]
        ? names.person(r.ballInCourt.userIds[0])
        : (r.ballInCourt.side ?? ''),
    ]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n');
}
