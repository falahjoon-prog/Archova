import type { DelayType, DiaryStatus, PlantStatus } from '@archova/domain';
import type { DiaryProblem } from '../commands';

export const diaryStatusLabel: Record<DiaryStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  signed_off: 'Signed off',
};

export const delayTypeLabel: Record<DelayType, string> = {
  weather: 'Weather',
  client: 'Client',
  design: 'Design',
  subcontractor: 'Subcontractor',
  authority: 'Authority',
  industrial: 'Industrial action',
  other: 'Other',
};

export const plantStatusLabel: Record<PlantStatus, string> = {
  working: 'Working',
  idle: 'Idle',
  broken_down: 'Broken down',
};

export const diaryErrorText: Record<DiaryProblem, string> = {
  'diary.amendment_reason_required': 'This day is submitted. Give a reason for the change first.',
  'diary.headcount_invalid': 'Enter a headcount between 1 and 999.',
  'diary.hours_invalid': 'Enter hours between 0 and 24, in quarter hours.',
  'diary.description_required': 'Add a description.',
  'diary.date_invalid': 'That date is not valid.',
  'diary.photos_full': 'A day holds at most 50 photos.',
};
